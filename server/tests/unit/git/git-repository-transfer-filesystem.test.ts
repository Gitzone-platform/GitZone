import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  prepareGitRepositoryTransfer,
  rollbackPreparedGitRepositoryTransfer,
} from '../../../src/services/git/git-repository-transfer-filesystem.service.js';

import { inspectGitRepositoryTransferRecovery } from '../../../src/services/git/git-repository-transfer-recovery.service.js';
const state = vi.hoisted(() => ({ root: '' }));

vi.mock('../../../src/utils/git/repository-path.js', () => ({
  resolveGitRepositoryPath: (username: string, repositoryName: string) =>
    path.join(state.root, username, `${repositoryName}.git`),

  resolveOwnedGitRepositoryPath: (owner: { type: string; slug: string }, repositoryName: string) =>
    path.join(state.root, '.organizations', owner.slug, `${repositoryName}.git`),
}));

const source = () => path.join(state.root, 'alice', 'project.git');

const destination = () => path.join(state.root, '.organizations', 'team', 'project.git');

const transferId = 'cmtransferjournal00000001';

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitzone-transfer-test-'));

  await fs.mkdir(path.dirname(source()), { recursive: true });
  await fs.mkdir(path.dirname(destination()), { recursive: true });

  execFileSync('git', ['init', '--bare', source()], { stdio: 'pipe' });
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Git repository transfer filesystem', () => {
  it('creates missing organization storage directories safely', async () => {
    await fs.rm(path.join(state.root, '.organizations'), {
      recursive: true,
      force: true,
    });

    await prepareGitRepositoryTransfer('alice', 'team', 'project', transferId);

    expect((await fs.stat(destination())).isDirectory()).toBe(true);
    expect((await fs.stat(source())).isDirectory()).toBe(true);

    expect(await fs.readFile(path.join(destination(), '.gitzone-transfer-owner'), 'utf8')).toBe(
      transferId,
    );
  });

  it('rejects symbolic-link organization storage without writing through it', async () => {
    const organizationDirectory = path.dirname(destination());
    const externalDirectory = path.join(state.root, 'external-target');

    await fs.mkdir(externalDirectory);

    await fs.rm(organizationDirectory, {
      recursive: true,
      force: true,
    });

    await fs.symlink(
      externalDirectory,
      organizationDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      prepareGitRepositoryTransfer('alice', 'team', 'project', transferId),
    ).rejects.toThrow();

    expect(await fs.readdir(externalDirectory)).toEqual([]);

    expect((await fs.stat(source())).isDirectory()).toBe(true);
  });
  it('preserves source and partial publication after a rename failure', async () => {
    const originalRename = fs.rename.bind(fs);
    let renameCount = 0;

    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      renameCount += 1;

      if (renameCount === 2) {
        throw new Error('Simulated publication interruption');
      }

      return originalRename(oldPath, newPath);
    });

    const stagingPath = path.join(path.dirname(destination()), `.transfer-${transferId}`);

    try {
      await expect(
        prepareGitRepositoryTransfer('alice', 'team', 'project', transferId),
      ).rejects.toMatchObject({
        code: 'GIT_TRANSFER_PUBLICATION_FAILED',
      });

      expect(renameCount).toBeGreaterThanOrEqual(2);

      expect((await fs.stat(source())).isDirectory()).toBe(true);
      expect((await fs.stat(destination())).isDirectory()).toBe(true);
      expect((await fs.stat(stagingPath)).isDirectory()).toBe(true);

      const publishedEntries = await fs.readdir(destination());
      const stagedEntries = await fs.readdir(stagingPath);

      expect(publishedEntries.length).toBeGreaterThan(0);
      expect(stagedEntries.length).toBeGreaterThan(0);

      const sourceEntries = await fs.readdir(source());

      for (const entry of sourceEntries) {
        const existsInDestination = publishedEntries.includes(entry);
        const existsInStaging = stagedEntries.includes(entry);

        expect(existsInDestination || existsInStaging).toBe(true);
      }
    } finally {
      renameSpy.mockRestore();
    }
  });
  it('requires manual recovery after interrupted publication', async () => {
    const originalRename = fs.rename.bind(fs);
    let renameCount = 0;

    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      renameCount += 1;

      if (renameCount === 2) {
        throw new Error('Simulated interruption');
      }

      return originalRename(oldPath, newPath);
    });

    try {
      await expect(
        prepareGitRepositoryTransfer('alice', 'team', 'project', transferId),
      ).rejects.toMatchObject({
        code: 'GIT_TRANSFER_PUBLICATION_FAILED',
      });
    } finally {
      renameSpy.mockRestore();
    }

    const inspection = await inspectGitRepositoryTransferRecovery({
      sourceUsername: 'alice',
      targetOrgSlug: 'team',
      repositoryName: 'project',
      transferId,
    });

    expect(inspection.source).toBe('DIRECTORY');
    expect(inspection.destination).toBe('DIRECTORY');
    expect(inspection.staging).toBe('DIRECTORY');

    expect(inspection.safeToResumeAutomatically).toBe(false);
    expect(inspection.inspectionOnly).toBe(true);
    expect(inspection.requiresManualRecovery).toBe(true);

    expect((await fs.stat(source())).isDirectory()).toBe(true);
    expect((await fs.stat(destination())).isDirectory()).toBe(true);
  });
  it('copies a real bare repository without removing source', async () => {
    const paths = await prepareGitRepositoryTransfer('alice', 'team', 'project', transferId);

    expect((await fs.stat(source())).isDirectory()).toBe(true);
    expect((await fs.stat(destination())).isDirectory()).toBe(true);

    expect(
      execFileSync('git', ['--git-dir', destination(), 'rev-parse', '--is-bare-repository'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('true');

    expect(paths.destinationPath).toBe(destination());
    expect(await fs.readFile(path.join(destination(), '.gitzone-transfer-owner'), 'utf8')).toBe(
      transferId,
    );
  });

  it('rejects an existing destination without overwriting it', async () => {
    await fs.mkdir(destination());

    await fs.writeFile(path.join(destination(), 'sentinel.txt'), 'keep-me');

    await expect(
      prepareGitRepositoryTransfer('alice', 'team', 'project', transferId),
    ).rejects.toMatchObject({
      code: 'GIT_TRANSFER_DESTINATION_EXISTS',
    });

    expect(await fs.readFile(path.join(destination(), 'sentinel.txt'), 'utf8')).toBe('keep-me');

    expect((await fs.stat(source())).isDirectory()).toBe(true);
  });

  it('rejects rollback and preserves a completed destination', async () => {
    const paths = await prepareGitRepositoryTransfer('alice', 'team', 'project', transferId);

    await expect(rollbackPreparedGitRepositoryTransfer(paths)).rejects.toMatchObject({
      code: 'GIT_TRANSFER_MANUAL_RECOVERY_REQUIRED',
    });

    expect((await fs.stat(destination())).isDirectory()).toBe(true);
    expect((await fs.stat(source())).isDirectory()).toBe(true);
  });

  it('rejects rollback even when the destination marker matches', async () => {
    const paths = await prepareGitRepositoryTransfer('alice', 'team', 'project', transferId);

    expect(await fs.readFile(path.join(destination(), '.gitzone-transfer-owner'), 'utf8')).toBe(
      transferId,
    );

    await expect(rollbackPreparedGitRepositoryTransfer(paths)).rejects.toMatchObject({
      code: 'GIT_TRANSFER_MANUAL_RECOVERY_REQUIRED',
    });

    expect((await fs.stat(destination())).isDirectory()).toBe(true);
  });

  it('preserves foreign staging and destination during rollback', async () => {
    const paths = await prepareGitRepositoryTransfer('alice', 'team', 'project', transferId);

    await fs.mkdir(paths.stagingPath);

    await fs.writeFile(path.join(paths.stagingPath, '.gitzone-transfer-owner'), 'foreign-transfer');

    await expect(rollbackPreparedGitRepositoryTransfer(paths)).rejects.toMatchObject({
      code: 'GIT_TRANSFER_MANUAL_RECOVERY_REQUIRED',
    });

    expect((await fs.stat(paths.stagingPath)).isDirectory()).toBe(true);
    expect((await fs.stat(destination())).isDirectory()).toBe(true);
    expect((await fs.stat(source())).isDirectory()).toBe(true);
  });

  it('preserves staging when the destination is missing', async () => {
    const paths = await prepareGitRepositoryTransfer('alice', 'team', 'project', transferId);

    await fs.rm(destination(), { recursive: true });

    await fs.mkdir(paths.stagingPath);
    await fs.writeFile(path.join(paths.stagingPath, 'sentinel.txt'), 'keep');

    await expect(rollbackPreparedGitRepositoryTransfer(paths)).rejects.toMatchObject({
      code: 'GIT_TRANSFER_MANUAL_RECOVERY_REQUIRED',
    });

    expect(await fs.readFile(path.join(paths.stagingPath, 'sentinel.txt'), 'utf8')).toBe('keep');

    expect((await fs.stat(source())).isDirectory()).toBe(true);
  });
});
