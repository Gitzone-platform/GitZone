import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOrganizationGitRepository } from '../../../src/services/git/git-repository.service.js';
import { resolveOwnedGitRepositoryPath } from '../../../src/utils/git/repository-path.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    mkdir: vi.fn(),
    lstat: vi.fn(),
    rm: vi.fn(),
  },
}));

vi.mock('../../../src/utils/git/repository-path.js', () => ({
  resolveGitRepositoryPath: vi.fn(),
  resolveOwnedGitRepositoryPath: vi.fn(),
}));

const gitPath = 'storage/.organizations/engineering/platform.git';

const mockedExec = vi.mocked(execFile);
const mockedAccess = vi.mocked(fs.access);
const mockedMkdir = vi.mocked(fs.mkdir);
const mockedLstat = vi.mocked(fs.lstat);
const mockedRemove = vi.mocked(fs.rm);
const mockedResolve = vi.mocked(resolveOwnedGitRepositoryPath);

const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });

const gitSuccess = () => {
  mockedExec.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);

    if (typeof callback === 'function') {
      callback(null, '', '');
    }

    return {} as never;
  });
};

const gitFailure = () => {
  mockedExec.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);

    if (typeof callback === 'function') {
      callback(new Error('Git failed'));
    }

    return {} as never;
  });
};

describe('organization Git repository creation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedResolve.mockReturnValue(gitPath);
    mockedAccess.mockRejectedValue(missing);
    mockedMkdir.mockResolvedValue(undefined);
    mockedLstat.mockResolvedValue({ isDirectory: () => true, isSymbolicLink: () => false } as Awaited<ReturnType<typeof fs.lstat>>);
    gitSuccess();
  });

  it('creates a bare Git repository in organization storage', async () => {
    const result = await createOrganizationGitRepository('engineering', 'platform');

    expect(result).toBe(gitPath);
    expect(mockedResolve).toHaveBeenCalledWith(
      { type: 'ORGANIZATION', slug: 'engineering' },
      'platform',
    );
    expect(mockedExec).toHaveBeenCalledTimes(2);
    expect(mockedExec).toHaveBeenNthCalledWith(
      1,
      'git',
      ['init', '--bare', '--initial-branch=main', gitPath],
      expect.any(Function),
    );
    expect(mockedExec).toHaveBeenNthCalledWith(
      2,
      'git',
      ['--git-dir', gitPath, 'config', 'http.receivepack', 'true'],
      expect.any(Function),
    );
  });

  it('rejects an existing repository path', async () => {
    mockedMkdir.mockRejectedValue(Object.assign(new Error('exists'), { code: 'EEXIST' }));

    await expect(createOrganizationGitRepository('engineering', 'platform')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_REPOSITORY_ALREADY_EXISTS',
    });

    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('rejects parent storage preparation failures', async () => {
    mockedMkdir.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

    await expect(createOrganizationGitRepository('engineering', 'platform')).rejects.toMatchObject({
      code: 'ORGANIZATION_GIT_STORAGE_PREPARATION_FAILED',
    });

    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('rejects repository reservation failures', async () => {
    mockedMkdir.mockImplementation(async (directoryPath) => {
      if (directoryPath === gitPath) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }

      return undefined;
    });

    await expect(createOrganizationGitRepository('engineering', 'platform')).rejects.toMatchObject({
      code: 'GIT_REPOSITORY_INSPECTION_FAILED',
    });

    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('rejects symbolic links in organization storage parents', async () => {
    mockedLstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => true,
    } as Awaited<ReturnType<typeof fs.lstat>>);

    await expect(createOrganizationGitRepository('engineering', 'platform')).rejects.toMatchObject({
      code: 'UNSAFE_ORGANIZATION_GIT_STORAGE',
    });

    expect(mockedExec).not.toHaveBeenCalled();
    expect(mockedMkdir).not.toHaveBeenCalledWith(gitPath, { recursive: false });
  });

  it('rejects non-directory organization storage parents', async () => {
    mockedLstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
    } as Awaited<ReturnType<typeof fs.lstat>>);

    await expect(createOrganizationGitRepository('engineering', 'platform')).rejects.toMatchObject({
      code: 'UNSAFE_ORGANIZATION_GIT_STORAGE',
    });

    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('rejects parent storage inspection failures', async () => {
    mockedLstat.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

    await expect(createOrganizationGitRepository('engineering', 'platform')).rejects.toMatchObject({
      code: 'ORGANIZATION_GIT_STORAGE_INSPECTION_FAILED',
    });

    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('cleans up when Git initialization fails', async () => {
    gitFailure();
    mockedRemove.mockResolvedValue(undefined);

    await expect(createOrganizationGitRepository('engineering', 'platform')).rejects.toMatchObject({
      code: 'GIT_REPOSITORY_CREATE_FAILED',
    });

    expect(mockedRemove).toHaveBeenCalledWith(gitPath, {
      recursive: true,
      force: true,
    });
  });

  it('reports cleanup failure', async () => {
    gitFailure();
    mockedRemove.mockRejectedValue(new Error('cleanup failed'));

    await expect(createOrganizationGitRepository('engineering', 'platform')).rejects.toMatchObject({
      code: 'GIT_REPOSITORY_CREATE_CLEANUP_FAILED',
    });
  });

  it('rejects invalid paths before filesystem operations', async () => {
    mockedResolve.mockImplementation(() => {
      throw new Error('Unsafe path');
    });

    await expect(createOrganizationGitRepository('../outside', 'platform')).rejects.toThrow(
      'Unsafe path',
    );

    expect(mockedExec).not.toHaveBeenCalled();
    expect(mockedMkdir).not.toHaveBeenCalled();
    expect(mockedRemove).not.toHaveBeenCalled();
  });
});
