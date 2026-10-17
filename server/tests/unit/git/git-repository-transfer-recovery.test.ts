import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const state = vi.hoisted(() => ({
  root: '',
}));

vi.mock(
  '../../../src/utils/git/repository-path.js',
  () => ({
    resolveGitRepositoryPath: (
      username: string,
      repositoryName: string,
    ) =>
      path.join(state.root, username, `${repositoryName}.git`),

    resolveOwnedGitRepositoryPath: (
      owner: { type: string; slug: string },
      repositoryName: string,
    ) =>
      path.join(
        state.root,
        '.organizations',
        owner.slug,
        `${repositoryName}.git`,
      ),
  }),
);

import {
  inspectGitRepositoryTransferRecovery,
} from '../../../src/services/git/git-repository-transfer-recovery.service.js';

const transferId = 'cmtransferjournal00000001';

const input = {
  sourceUsername: 'alice',
  targetOrgSlug: 'team',
  repositoryName: 'project',
  transferId,
};

beforeEach(async () => {
  state.root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gitzone-recovery-'),
  );

  await fs.mkdir(
    path.join(state.root, 'alice', 'project.git'),
    { recursive: true },
  );
});

afterEach(async () => {
  await fs.rm(state.root, {
    recursive: true,
    force: true,
  });
});

describe('Git transfer recovery inspection', () => {
  it('detects an untouched source repository', async () => {
    const result = await inspectGitRepositoryTransferRecovery(input);

    expect(result.source).toBe('DIRECTORY');
    expect(result.staging).toBe('MISSING');
    expect(result.destination).toBe('MISSING');
    expect(result.requiresManualRecovery).toBe(false);
    expect(result.safeToResumeAutomatically).toBe(false);
    expect(result.inspectionOnly).toBe(true);
  });

  it('detects an owned staging directory', async () => {
    const staging = path.join(
      state.root,
      '.organizations',
      'team',
      `.transfer-${transferId}`,
    );

    await fs.mkdir(staging, { recursive: true });
    await fs.writeFile(
      path.join(staging, '.gitzone-transfer-owner'),
      transferId,
    );

    const result = await inspectGitRepositoryTransferRecovery(input);

    expect(result.staging).toBe('DIRECTORY');
    expect(result.stagingOwnedByTransfer).toBe(true);
  });

  it('flags a foreign destination for manual recovery', async () => {
    const destination = path.join(
      state.root,
      '.organizations',
      'team',
      'project.git',
    );

    await fs.mkdir(destination, { recursive: true });

    const result = await inspectGitRepositoryTransferRecovery(input);

    expect(result.destination).toBe('DIRECTORY');
    expect(result.destinationOwnedByTransfer).toBe(false);
    expect(result.requiresManualRecovery).toBe(true);
  });

  it('rejects invalid transfer identifiers', async () => {
    await expect(
      inspectGitRepositoryTransferRecovery({
        ...input,
        transferId: '../unsafe',
      }),
    ).rejects.toThrow();
  });
});
