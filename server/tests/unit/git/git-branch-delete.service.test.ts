import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitWriteError } from '../../../src/errors/git-write.error.js';
import { executeGitReadCommand } from '../../../src/services/git/git-read-command.service.js';
import { deleteGitBranch } from '../../../src/services/git/git-branch-mutation.service.js';
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

const oid = '1111111111111111111111111111111111111111';

const refs = {
  objectFormat: 'sha1' as const,
  symbolicHead: 'refs/heads/main',
  defaultBranch: 'main',
  head: {
    name: 'main',
    fullName: 'refs/heads/main',
    oid,
    objectType: 'commit' as const,
  },
  branches: [
    {
      name: 'main',
      fullName: 'refs/heads/main',
      oid,
      objectType: 'commit' as const,
    },
    {
      name: 'feature/login',
      fullName: 'refs/heads/feature/login',
      oid,
      objectType: 'commit' as const,
    },
  ],
  tags: [],
};

describe('deleteGitBranch', () => {
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

  it('deletes a branch using expected OID', async () => {
    await deleteGitBranch({
      username: 'asil',
      repositoryName: 'demo',
      branchName: 'feature/login',
    });

    expect(mockedWrite).toHaveBeenCalledWith({
      username: 'asil',
      repositoryName: 'demo',
      args: ['update-ref', '-d', 'refs/heads/feature/login', oid],
    });
  });

  it('rejects an unsafe branch before Git access', async () => {
    await expect(
      deleteGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: '../main',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_GIT_BRANCH_NAME',
    });

    expect(mockedRead).not.toHaveBeenCalled();
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('rejects a branch rejected by Git ref validation', async () => {
    mockedRead.mockRejectedValueOnce(new Error('invalid ref'));

    await expect(
      deleteGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'feature',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_GIT_BRANCH_NAME',
    });

    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing branch', async () => {
    await expect(
      deleteGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'missing',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'GIT_BRANCH_NOT_FOUND',
    });

    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('protects the default branch', async () => {
    await expect(
      deleteGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'main',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_DEFAULT_BRANCH_PROTECTED',
    });

    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('maps concurrent deletion to a conflict', async () => {
    mockedWrite.mockRejectedValueOnce(
      new GitWriteError('update-ref failed', 'GIT_WRITE_COMMAND_FAILED', {
        exitCode: 128,
      }),
    );

    await expect(
      deleteGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'feature/login',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_BRANCH_CONFLICT',
    });
  });

  it('preserves infrastructure write failures', async () => {
    const error = new GitWriteError('Git timed out', 'GIT_WRITE_TIMEOUT');

    mockedWrite.mockRejectedValueOnce(error);

    await expect(
      deleteGitBranch({
        username: 'asil',
        repositoryName: 'demo',
        branchName: 'feature/login',
      }),
    ).rejects.toBe(error);
  });
});
