import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedLstat, mockedRename } = vi.hoisted(() => ({
  mockedLstat: vi.fn(),
  mockedRename: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    lstat: mockedLstat,
    rename: mockedRename,
  },
}));

process.env.GIT_STORAGE_PATH = './storage/test-repositories';

const { renameGitUserDirectory } =
  await import('../../../src/services/git/git-user-directory.service.js');

const missingEntry = () => Object.assign(new Error('Not found'), { code: 'ENOENT' });

const directoryStat = () => ({
  isDirectory: () => true,
  isSymbolicLink: () => false,
});

const symlinkStat = () => ({
  isDirectory: () => false,
  isSymbolicLink: () => true,
});

const fileStat = () => ({
  isDirectory: () => false,
  isSymbolicLink: () => false,
});

describe('Git user directory rename service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedLstat.mockImplementation(async (target: string) => {
      if (target.endsWith(`${path.sep}olduser`)) {
        return directoryStat();
      }

      throw missingEntry();
    });

    mockedRename.mockResolvedValue(undefined);
  });

  it('renames the user storage directory', async () => {
    await expect(renameGitUserDirectory('olduser', 'newuser')).resolves.toBe(true);

    expect(mockedRename).toHaveBeenCalledWith(
      expect.stringContaining(path.join('test-repositories', 'olduser')),
      expect.stringContaining(path.join('test-repositories', 'newuser')),
    );
  });

  it('does nothing when usernames are identical', async () => {
    await expect(renameGitUserDirectory('olduser', 'olduser')).resolves.toBe(false);

    expect(mockedLstat).not.toHaveBeenCalled();
    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('rejects case-only username changes', async () => {
    await expect(renameGitUserDirectory('olduser', 'OldUser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_USERNAME_CASE_CONFLICT',
    });

    expect(mockedLstat).not.toHaveBeenCalled();
    expect(mockedRename).not.toHaveBeenCalled();
  });
  it('returns false when source directory is missing', async () => {
    mockedLstat.mockRejectedValue(missingEntry());

    await expect(renameGitUserDirectory('olduser', 'newuser')).resolves.toBe(false);

    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('rejects destination collision even when source is missing', async () => {
    mockedLstat.mockImplementation(async (target: string) => {
      if (target.endsWith(`${path.sep}olduser`)) {
        throw missingEntry();
      }

      if (target.endsWith(`${path.sep}newuser`)) {
        return directoryStat();
      }

      throw missingEntry();
    });

    await expect(renameGitUserDirectory('olduser', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_USER_DIRECTORY_ALREADY_EXISTS',
    });

    expect(mockedRename).not.toHaveBeenCalled();
  });
  it('rejects an existing destination directory', async () => {
    mockedLstat.mockResolvedValue(directoryStat());

    await expect(renameGitUserDirectory('olduser', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_USER_DIRECTORY_ALREADY_EXISTS',
    });

    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('rejects a symbolic link as the source', async () => {
    mockedLstat.mockResolvedValueOnce(symlinkStat());

    await expect(renameGitUserDirectory('olduser', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_USER_DIRECTORY_INVALID',
    });

    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('rejects a regular file as the source', async () => {
    mockedLstat.mockResolvedValueOnce(fileStat());

    await expect(renameGitUserDirectory('olduser', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_USER_DIRECTORY_INVALID',
    });
  });

  it.each(['../outside', '..', '.', 'folder/user', 'folder\\user', ''])(
    'rejects unsafe new username: %s',
    async (username) => {
      await expect(renameGitUserDirectory('olduser', username)).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_GIT_REPOSITORY_PATH',
      });

      expect(mockedRename).not.toHaveBeenCalled();
    },
  );

  it('rejects filesystem inspection errors', async () => {
    mockedLstat.mockRejectedValue(
      Object.assign(new Error('Permission denied'), {
        code: 'EACCES',
      }),
    );

    await expect(renameGitUserDirectory('olduser', 'newuser')).rejects.toMatchObject({
      statusCode: 500,
      code: 'GIT_USER_DIRECTORY_INSPECTION_FAILED',
    });
  });

  it('handles destination collision during rename', async () => {
    mockedRename.mockRejectedValue(
      Object.assign(new Error('Already exists'), {
        code: 'EEXIST',
      }),
    );

    let destinationChecks = 0;

    mockedLstat.mockImplementation(async (target: string) => {
      if (target.endsWith(`${path.sep}olduser`)) {
        return directoryStat();
      }

      if (target.endsWith(`${path.sep}newuser`)) {
        destinationChecks += 1;

        if (destinationChecks === 1) {
          throw missingEntry();
        }

        return directoryStat();
      }

      throw missingEntry();
    });

    await expect(renameGitUserDirectory('olduser', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_USER_DIRECTORY_ALREADY_EXISTS',
    });

    expect(destinationChecks).toBe(2);
    expect(mockedRename).toHaveBeenCalledOnce();
  });

  it('detects destination collision after Windows EPERM', async () => {
    mockedRename.mockRejectedValue(
      Object.assign(new Error('Permission denied'), {
        code: 'EPERM',
      }),
    );

    mockedLstat.mockImplementation(async (target: string) => {
      if (target.endsWith(`${path.sep}olduser`) || target.endsWith(`${path.sep}newuser`)) {
        return directoryStat();
      }

      throw missingEntry();
    });

    await expect(renameGitUserDirectory('olduser', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_USER_DIRECTORY_ALREADY_EXISTS',
    });
  });

  it('reports rename failure when EPERM has no destination collision', async () => {
    mockedRename.mockRejectedValue(
      Object.assign(new Error('Permission denied'), {
        code: 'EPERM',
      }),
    );

    await expect(renameGitUserDirectory('olduser', 'newuser')).rejects.toMatchObject({
      statusCode: 500,
      code: 'GIT_USER_DIRECTORY_RENAME_FAILED',
    });
  });
  it('handles filesystem rename errors', async () => {
    mockedRename.mockRejectedValue(
      Object.assign(new Error('Rename failed'), {
        code: 'EACCES',
      }),
    );

    await expect(renameGitUserDirectory('olduser', 'newuser')).rejects.toMatchObject({
      statusCode: 500,
      code: 'GIT_USER_DIRECTORY_RENAME_FAILED',
    });
  });
});
