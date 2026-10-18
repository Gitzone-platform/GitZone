import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitWriteError } from '../../../src/errors/git-write.error.js';
import { executeGitReadCommand } from '../../../src/services/git/git-read-command.service.js';
import { renameGitBranch } from '../../../src/services/git/git-branch-mutation.service.js';
import { getGitRepositoryRefs } from '../../../src/services/git/git-ref.service.js';
import { executeGitWriteCommand } from '../../../src/services/git/git-write-command.service.js';

vi.mock('../../../src/services/git/git-read-command.service.js', () => ({
  executeGitReadCommand: vi.fn(),
}));

vi.mock('../../../src/services/git/git-ref.service.js', () => ({
  getGitRepositoryRefs: vi.fn(),
}));

vi.mock('../../../src/services/git/git-write-command.service.js', () => ({
  executeGitWriteCommand: vi.fn(),
}));

const mockedRead = vi.mocked(executeGitReadCommand);

const mockedRefs = vi.mocked(getGitRepositoryRefs);

const mockedWrite = vi.mocked(executeGitWriteCommand);

const mainOid = '1111111111111111111111111111111111111111';

const featureOid = '2222222222222222222222222222222222222222';

const refs = {
  objectFormat: 'sha1' as const,
  symbolicHead: 'refs/heads/main',
  defaultBranch: 'main',
  head: {
    name: 'main',
    fullName: 'refs/heads/main',
    oid: mainOid,
    objectType: 'commit' as const,
  },
  branches: [
    {
      name: 'main',
      fullName: 'refs/heads/main',
      oid: mainOid,
      objectType: 'commit' as const,
    },
    {
      name: 'feature/login',
      fullName: 'refs/heads/feature/login',
      oid: featureOid,
      objectType: 'commit' as const,
    },
    {
      name: 'develop',
      fullName: 'refs/heads/develop',
      oid: featureOid,
      objectType: 'commit' as const,
    },
  ],
  tags: [],
};

describe('renameGitBranch', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedRead.mockResolvedValue({
      stdout: '',
      stderr: '',
    });

    mockedRefs.mockResolvedValue(refs);

    mockedWrite.mockResolvedValue({
      stdout: '',
      stderr: '',
    });
  });

  it('renames a branch atomically', async () => {
    const branch = await renameGitBranch({
      username: 'asil',
      repositoryName: 'demo',
      branchName: 'feature/login',
      newBranchName: 'feature/auth',
    });

    expect(branch).toEqual({
      name: 'feature/auth',
      fullName: 'refs/heads/feature/auth',
      oid: featureOid,
      objectType: 'commit',
    });

    expect(mockedWrite).toHaveBeenCalledWith({
      username: 'asil',
      repositoryName: 'demo',
      args: ['update-ref', '--stdin'],
      stdin: [
        `create refs/heads/feature/auth ${featureOid}`,
        `delete refs/heads/feature/login ${featureOid}`,
        '',
      ].join('\n'),
    });
  });

  it('validates both branch names with Git', async () => {
    await renameGitBranch({
      username: 'asil',
      repositoryName: 'demo',
      branchName: 'feature/login',
      newBranchName: 'feature/auth',
    });

    expect(mockedRead).toHaveBeenCalledTimes(2);
  });

  it('rejects unsafe source branch names', async () => {
    await expect(
      renameGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: '../main',
        newBranchName: 'feature/auth',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_GIT_BRANCH_NAME',
    });

    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('rejects unsafe target branch names', async () => {
    await expect(
      renameGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'feature/login',
        newBranchName: '../auth',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_GIT_BRANCH_NAME',
    });

    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('returns 404 when source branch is missing', async () => {
    await expect(
      renameGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'missing',
        newBranchName: 'feature/auth',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'GIT_BRANCH_NOT_FOUND',
    });
  });

  it('protects the default branch', async () => {
    await expect(
      renameGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'main',
        newBranchName: 'primary',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_DEFAULT_BRANCH_PROTECTED',
    });

    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('rejects an existing target branch', async () => {
    await expect(
      renameGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'feature/login',
        newBranchName: 'develop',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_BRANCH_ALREADY_EXISTS',
    });
  });

  it('maps concurrent rename failure to conflict', async () => {
    mockedWrite.mockRejectedValueOnce(
      new GitWriteError('transaction failed', 'GIT_WRITE_COMMAND_FAILED', {
        exitCode: 128,
      }),
    );

    await expect(
      renameGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'feature/login',
        newBranchName: 'feature/auth',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_BRANCH_CONFLICT',
    });
  });

  it('preserves infrastructure failures', async () => {
    const error = new GitWriteError('Git timed out', 'GIT_WRITE_TIMEOUT');

    mockedWrite.mockRejectedValueOnce(error);

    await expect(
      renameGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'feature/login',
        newBranchName: 'feature/auth',
      }),
    ).rejects.toBe(error);
  });
});
