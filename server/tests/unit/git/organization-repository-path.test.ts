import path from 'node:path';

import { describe, expect, it } from 'vitest';

process.env.GIT_STORAGE_PATH = './storage/test-repositories';

const { resolveGitRepositoryPath, resolveOwnedGitRepositoryPath } =
  await import('../../../src/utils/git/repository-path.js');

const storageRoot = path.resolve(process.cwd(), process.env.GIT_STORAGE_PATH);

describe('Owned Git repository path resolver', () => {
  it('preserves the legacy user repository path', () => {
    const legacy = resolveGitRepositoryPath('asilbek2706', 'portfolio');

    const owned = resolveOwnedGitRepositoryPath(
      { type: 'USER', username: 'asilbek2706' },
      'portfolio',
    );

    expect(owned).toBe(legacy);
    expect(owned).toBe(path.join(storageRoot, 'asilbek2706', 'portfolio.git'));
  });

  it('isolates organization repositories under .organizations', () => {
    const result = resolveOwnedGitRepositoryPath(
      { type: 'ORGANIZATION', slug: 'gitzone-team' },
      'backend',
    );

    expect(result).toBe(path.join(storageRoot, '.organizations', 'gitzone-team', 'backend.git'));
  });

  it('keeps user and organization repository paths separate', () => {
    const userPath = resolveOwnedGitRepositoryPath(
      { type: 'USER', username: 'gitzone-team' },
      'backend',
    );

    const organizationPath = resolveOwnedGitRepositoryPath(
      { type: 'ORGANIZATION', slug: 'gitzone-team' },
      'backend',
    );

    expect(userPath).not.toBe(organizationPath);
  });

  it.each(['../escape', '..', '.', '/tmp', 'team/name', 'team\\name', ''])(
    'rejects unsafe organization slug "%s"',
    (slug) => {
      expect(() =>
        resolveOwnedGitRepositoryPath({ type: 'ORGANIZATION', slug }, 'backend'),
      ).toThrowError(
        expect.objectContaining({
          code: 'INVALID_GIT_REPOSITORY_PATH',
        }),
      );
    },
  );

  it.each(['../escape', '..', '.', '/tmp', 'repo/name', 'repo\\name', ''])(
    'rejects unsafe organization repository name "%s"',
    (name) => {
      expect(() =>
        resolveOwnedGitRepositoryPath({ type: 'ORGANIZATION', slug: 'gitzone-team' }, name),
      ).toThrowError(
        expect.objectContaining({
          code: 'INVALID_GIT_REPOSITORY_PATH',
        }),
      );
    },
  );
});
