import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { AppError } from '../../errors/app.error.js';
import {
  resolveGitRepositoryPath,
  resolveOwnedGitRepositoryPath,
} from '../../utils/git/repository-path.js';

const execFileAsync = promisify(execFile);

export type StagedGitRepositoryDeletion = {
  username: string;
  repositoryName: string;
  stagedRepositoryName: string;
};

const hasErrorCode = (error: unknown, code: string): boolean => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as NodeJS.ErrnoException).code === code;
};

export const createGitRepository = async (
  username: string,
  repositoryName: string,
): Promise<string> => {
  const repositoryPath = resolveGitRepositoryPath(username, repositoryName);

  try {
    await fs.access(repositoryPath);

    throw new AppError('Git repository path already exists', 409, 'GIT_REPOSITORY_ALREADY_EXISTS');
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (!hasErrorCode(error, 'ENOENT')) {
      throw new AppError(
        'Failed to inspect Git repository path',
        500,
        'GIT_REPOSITORY_INSPECTION_FAILED',
      );
    }
  }

  try {
    await execFileAsync('git', ['init', '--bare', '--initial-branch=main', repositoryPath]);

    await execFileAsync('git', ['--git-dir', repositoryPath, 'config', 'http.receivepack', 'true']);
  } catch {
    try {
      await fs.rm(repositoryPath, {
        recursive: true,
        force: true,
      });
    } catch {
      throw new AppError(
        'Failed to clean up partially created Git repository',
        500,
        'GIT_REPOSITORY_CREATE_CLEANUP_FAILED',
      );
    }

    throw new AppError('Failed to create Git repository', 500, 'GIT_REPOSITORY_CREATE_FAILED');
  }

  return repositoryPath;
};

const ensureOrganizationStorageDirectory = async (directoryPath: string): Promise<void> => {
  try {
    await fs.mkdir(directoryPath, { recursive: false });
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) {
      throw new AppError(
        'Failed to prepare organization Git storage',
        500,
        'ORGANIZATION_GIT_STORAGE_PREPARATION_FAILED',
      );
    }
  }

  let stats;

  try {
    stats = await fs.lstat(directoryPath);
  } catch {
    throw new AppError(
      'Failed to inspect organization Git storage',
      500,
      'ORGANIZATION_GIT_STORAGE_INSPECTION_FAILED',
    );
  }

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new AppError(
      'Unsafe organization Git storage directory',
      500,
      'UNSAFE_ORGANIZATION_GIT_STORAGE',
    );
  }
};
export const createOrganizationGitRepository = async (
  organizationSlug: string,
  repositoryName: string,
): Promise<string> => {
  const repositoryPath = resolveOwnedGitRepositoryPath(
    { type: 'ORGANIZATION', slug: organizationSlug },
    repositoryName,
  );

  const organizationDirectory = path.dirname(repositoryPath);
  const namespaceDirectory = path.dirname(organizationDirectory);
  const storageDirectory = path.dirname(namespaceDirectory);

  await ensureOrganizationStorageDirectory(storageDirectory);
  await ensureOrganizationStorageDirectory(namespaceDirectory);
  await ensureOrganizationStorageDirectory(organizationDirectory);

  try {
    await fs.mkdir(repositoryPath, { recursive: false });
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) {
      throw new AppError(
        'Git repository path already exists',
        409,
        'GIT_REPOSITORY_ALREADY_EXISTS',
      );
    }

    throw new AppError(
      'Failed to reserve Git repository path',
      500,
      'GIT_REPOSITORY_INSPECTION_FAILED',
    );
  }

  try {
    await execFileAsync('git', ['init', '--bare', '--initial-branch=main', repositoryPath]);

    await execFileAsync('git', ['--git-dir', repositoryPath, 'config', 'http.receivepack', 'true']);
  } catch {
    try {
      await fs.rm(repositoryPath, { recursive: true, force: true });
    } catch {
      throw new AppError(
        'Failed to clean up partially created Git repository',
        500,
        'GIT_REPOSITORY_CREATE_CLEANUP_FAILED',
      );
    }

    throw new AppError('Failed to create Git repository', 500, 'GIT_REPOSITORY_CREATE_FAILED');
  }

  return repositoryPath;
};
export const renameGitRepository = async (
  username: string,
  oldRepositoryName: string,
  newRepositoryName: string,
): Promise<void> => {
  const oldRepositoryPath = resolveGitRepositoryPath(username, oldRepositoryName);

  const newRepositoryPath = resolveGitRepositoryPath(username, newRepositoryName);

  try {
    await fs.rename(oldRepositoryPath, newRepositoryPath);
  } catch {
    throw new AppError('Failed to rename Git repository', 500, 'GIT_REPOSITORY_RENAME_FAILED');
  }
};

export const stageGitRepositoryDeletion = async (
  username: string,
  repositoryName: string,
): Promise<StagedGitRepositoryDeletion | null> => {
  const originalPath = resolveGitRepositoryPath(username, repositoryName);

  const stagedRepositoryName = `${repositoryName}.deleting-${randomUUID()}`;

  const stagedPath = resolveGitRepositoryPath(username, stagedRepositoryName);

  try {
    await fs.rename(originalPath, stagedPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw new AppError(
      'Failed to stage Git repository deletion',
      500,
      'GIT_REPOSITORY_DELETE_STAGE_FAILED',
    );
  }

  return {
    username,
    repositoryName,
    stagedRepositoryName,
  };
};

export const restoreStagedGitRepositoryDeletion = async (
  stagedDeletion: StagedGitRepositoryDeletion,
): Promise<void> => {
  const originalPath = resolveGitRepositoryPath(
    stagedDeletion.username,
    stagedDeletion.repositoryName,
  );

  const stagedPath = resolveGitRepositoryPath(
    stagedDeletion.username,
    stagedDeletion.stagedRepositoryName,
  );

  try {
    await fs.rename(stagedPath, originalPath);
  } catch {
    throw new AppError(
      'Failed to restore staged Git repository',
      500,
      'GIT_REPOSITORY_DELETE_RESTORE_FAILED',
    );
  }
};

export const finalizeStagedGitRepositoryDeletion = async (
  stagedDeletion: StagedGitRepositoryDeletion,
): Promise<void> => {
  const stagedPath = resolveGitRepositoryPath(
    stagedDeletion.username,
    stagedDeletion.stagedRepositoryName,
  );

  try {
    await fs.rm(stagedPath, {
      recursive: true,
      force: true,
    });
  } catch {
    throw new AppError(
      'Failed to finalize Git repository deletion',
      500,
      'GIT_REPOSITORY_DELETE_FINALIZE_FAILED',
    );
  }
};

export const deleteGitRepository = async (
  username: string,
  repositoryName: string,
): Promise<void> => {
  const repositoryPath = resolveGitRepositoryPath(username, repositoryName);

  try {
    await fs.rm(repositoryPath, {
      recursive: true,
      force: true,
    });
  } catch {
    throw new AppError('Failed to delete Git repository', 500, 'GIT_REPOSITORY_DELETE_FAILED');
  }
};

/**
 * Repository transfer is intentionally disabled until a safe,
 * cross-platform no-overwrite strategy and rollback protocol
 * are implemented and tested.
 *
 * Never move repository data with an unchecked fs.rename().
 */
export const transferGitRepositoryToOrganization = async (
  _username: string,
  _organizationSlug: string,
  _repositoryName: string,
): Promise<never> => {
  throw new AppError(
    'Repository transfer is not available yet',
    501,
    'GIT_REPOSITORY_TRANSFER_NOT_IMPLEMENTED',
  );
};

export const rollbackGitRepositoryTransfer = async (
  _username: string,
  _organizationSlug: string,
  _repositoryName: string,
): Promise<never> => {
  throw new AppError(
    'Repository transfer rollback is not available yet',
    501,
    'GIT_REPOSITORY_TRANSFER_ROLLBACK_NOT_IMPLEMENTED',
  );
};
