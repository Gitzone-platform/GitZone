import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { verifyGitRepositoryIntegrity } from '../../../src/services/git/git-repository-transfer-integrity.service.js';

let root: string;
let repository: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitzone-integrity-'));

  repository = path.join(root, 'project.git');

  execFileSync('git', ['init', '--bare', repository], {
    stdio: 'pipe',
  });
});

afterEach(async () => {
  await fs.rm(root, {
    recursive: true,
    force: true,
  });
});

describe('Git repository integrity verification', () => {
  it('accepts a valid bare Git repository', async () => {
    const result = await verifyGitRepositoryIntegrity(repository);

    expect(result.valid).toBe(true);
    expect(result.bare).toBe(true);
    expect(result.fsckPassed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('rejects a missing repository', async () => {
    const result = await verifyGitRepositoryIntegrity(path.join(root, 'missing.git'));

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('REPOSITORY_NOT_ACCESSIBLE');
  });

  it('rejects a directory that is not a Git repository', async () => {
    const directory = path.join(root, 'not-git');

    await fs.mkdir(directory);

    const result = await verifyGitRepositoryIntegrity(directory);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('INVALID_GIT_REPOSITORY');
  });

  it('rejects a non-bare Git repository', async () => {
    const directory = path.join(root, 'working-tree');

    execFileSync('git', ['init', directory], {
      stdio: 'pipe',
    });

    const result = await verifyGitRepositoryIntegrity(directory);

    expect(result.valid).toBe(false);
  });

  it('rejects a corrupted bare Git repository', async () => {
    await fs.writeFile(path.join(repository, 'HEAD'), 'invalid-head-content');

    const result = await verifyGitRepositoryIntegrity(repository);

    expect(result.valid).toBe(false);
  });
});
