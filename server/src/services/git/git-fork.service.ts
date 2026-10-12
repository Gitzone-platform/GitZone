import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { AppError } from '../../errors/app.error.js';
import { resolveGitRepositoryPath } from '../../utils/git/repository-path.js';

const execFileAsync = promisify(execFile);

const hasErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

export const cloneBareGitRepositoryForFork = async (
  sourceUsername: string,
  sourceRepositoryName: string,
  targetUsername: string,
  targetRepositoryName: string,
): Promise<string> => {
  const sourcePath = resolveGitRepositoryPath(sourceUsername, sourceRepositoryName);
  const targetPath = resolveGitRepositoryPath(targetUsername, targetRepositoryName);

  if (sourcePath === targetPath) {
    throw new AppError('Cannot fork a repository into itself', 409, 'FORK_SELF_COLLISION');
  }

  try {
    await fs.access(sourcePath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new AppError('Source Git repository not found', 404, 'SOURCE_GIT_REPOSITORY_NOT_FOUND');
    }

    throw new AppError(
      'Failed to inspect source Git repository',
      500,
      'SOURCE_GIT_REPOSITORY_INSPECTION_FAILED',
    );
  }

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.mkdir(targetPath);
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) {
      throw new AppError(
        'Target Git repository already exists',
        409,
        'GIT_REPOSITORY_ALREADY_EXISTS',
      );
    }

    throw new AppError('Failed to reserve fork destination', 500, 'GIT_FORK_RESERVE_FAILED');
  }

  try {
    await execFileAsync('git', ['clone', '--bare', '--no-hardlinks', '--', sourcePath, targetPath]);

    await execFileAsync('git', ['--git-dir', targetPath, 'config', 'http.receivepack', 'true']);

    return targetPath;
  } catch {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {
      throw new AppError(
        'Failed to clean up incomplete fork Git repository',
        500,
        'GIT_FORK_CLEANUP_FAILED',
      );
    }

    throw new AppError('Failed to clone Git repository for fork', 500, 'GIT_FORK_CLONE_FAILED');
  }
};
