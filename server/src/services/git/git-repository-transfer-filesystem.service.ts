import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../errors/app.error.js';


import {
  resolveGitRepositoryPath,
  resolveOwnedGitRepositoryPath,
} from '../../utils/git/repository-path.js';

export type GitTransferPaths = {
  sourcePath: string;
  destinationPath: string;
  stagingPath: string;
  transferId: string;
};

const markerName = '.gitzone-transfer-owner';

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }

    throw error;
  }
};

const assertRealDirectory = async (target: string): Promise<void> => {
  const stats = await fs.lstat(target);

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new AppError(
      'Unsafe Git repository directory',
      409,
      'GIT_TRANSFER_UNSAFE_DIRECTORY',
    );
  }
};

const assertNoSymbolicLinks = async (directory: string): Promise<void> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const stats = await fs.lstat(entryPath);

    if (stats.isSymbolicLink()) {
      throw new AppError(
        'Git repository contains an unsafe symbolic link',
        409,
        'GIT_TRANSFER_UNSAFE_SYMLINK',
      );
    }

    if (stats.isDirectory()) {
      await assertNoSymbolicLinks(entryPath);
    }
  }
};
/**
 * Prepare each storage directory independently.
 * Existing symbolic links and non-directory entries are rejected.
 */
const ensureTransferStorageDirectory = async (
  directoryPath: string,
): Promise<void> => {
  try {
    await fs.mkdir(directoryPath, { recursive: false });
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    ) {
      throw new AppError(
        'Failed to prepare transfer storage directory',
        500,
        'GIT_TRANSFER_STORAGE_PREPARATION_FAILED',
      );
    }
  }

  await assertRealDirectory(directoryPath);
};
export const prepareGitRepositoryTransfer = async (
  username: string,
  organizationSlug: string,
  repositoryName: string,
  transferId: string,
): Promise<GitTransferPaths> => {
  if (!/^[a-z0-9]{20,40}$/.test(transferId)) {
    throw new AppError(
      'Invalid transfer journal identifier',
      400,
      'GIT_TRANSFER_INVALID_IDENTIFIER',
    );
  }
  const sourcePath = resolveGitRepositoryPath(username, repositoryName);

  const destinationPath = resolveOwnedGitRepositoryPath(
    { type: 'ORGANIZATION', slug: organizationSlug },
    repositoryName,
  );

  await assertRealDirectory(path.dirname(sourcePath));
  await assertRealDirectory(sourcePath);
  await assertNoSymbolicLinks(sourcePath);
  const organizationDirectory = path.dirname(destinationPath);
  const namespaceDirectory = path.dirname(organizationDirectory);
  const storageDirectory = path.dirname(namespaceDirectory);

  await ensureTransferStorageDirectory(storageDirectory);
  await ensureTransferStorageDirectory(namespaceDirectory);
  await ensureTransferStorageDirectory(organizationDirectory);

  const stagingPath = path.join(
    path.dirname(destinationPath),
    `.transfer-${transferId}`,
  );

  // An existing destination must never be overwritten.
  if (await pathExists(destinationPath)) {
    throw new AppError(
      'Destination Git repository already exists',
      409,
      'GIT_TRANSFER_DESTINATION_EXISTS',
    );
  }

  await fs.mkdir(stagingPath, { recursive: false });

  {
    const sourceEntries = await fs.readdir(sourcePath);

    for (const entry of sourceEntries) {
      await fs.cp(
        path.join(sourcePath, entry),
        path.join(stagingPath, entry),
        {
          recursive: true,
          force: false,
          errorOnExist: true,
          dereference: false,
        },
      );
    }

    await fs.writeFile(
      path.join(stagingPath, markerName),
      transferId,
      { flag: 'wx' },
    );

    // Reserve the destination exclusively. Never replace an existing path.
    // Publication is deliberately non-atomic and must remain guarded by
    // the durable MOVING journal until destination integrity is verified.
    try {
      await fs.mkdir(destinationPath, { recursive: false });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        throw new AppError(
          'Destination Git repository already exists',
          409,
          'GIT_TRANSFER_DESTINATION_EXISTS',
        );
      }

      throw new AppError(
        'Git transfer destination reservation failed',
        500,
        'GIT_TRANSFER_PUBLICATION_FAILED',
      );
    }

    try {
      const entries = await fs.readdir(stagingPath);

      for (const entry of entries) {
        await fs.rename(
          path.join(stagingPath, entry),
          path.join(destinationPath, entry),
        );
      }

      await fs.rmdir(stagingPath);
    } catch {
      // Preserve both paths for read-only recovery inspection.
      // Never delete a partially published destination automatically.
      throw new AppError(
        'Git transfer publication failed; recovery required',
        500,
        'GIT_TRANSFER_PUBLICATION_FAILED',
      );
    }
    return {
      sourcePath,
      destinationPath,
      stagingPath,
      transferId,
    };
  }
};

/**
 * Destructive rollback is disabled.
 *
 * A transfer can be COMPLETED in the database while a caller still holds
 * an older filesystem paths object. Deleting the destination here could
 * destroy the active organization repository.
 *
 * Recovery must inspect the journal and filesystem without mutation.
 */
export const rollbackPreparedGitRepositoryTransfer = async (
  _paths: GitTransferPaths,
): Promise<never> => {
  throw new AppError(
    'Automatic Git repository transfer rollback is disabled',
    409,
    'GIT_TRANSFER_MANUAL_RECOVERY_REQUIRED',
  );
};