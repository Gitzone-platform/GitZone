import fs from 'node:fs/promises';
import path from 'node:path';

import {
  resolveGitRepositoryPath,
  resolveOwnedGitRepositoryPath,
} from '../../utils/git/repository-path.js';

export type GitTransferRecoveryInput = {
  sourceUsername: string;
  targetOrgSlug: string;
  repositoryName: string;
  transferId: string;
};

export type GitTransferPathState = 'MISSING' | 'DIRECTORY' | 'UNSAFE';

export type GitTransferRecoveryInspection = {
  source: GitTransferPathState;
  staging: GitTransferPathState;
  destination: GitTransferPathState;
  destinationOwnedByTransfer: boolean;
  stagingOwnedByTransfer: boolean;
  requiresManualRecovery: boolean;
  safeToResumeAutomatically: false;
  inspectionOnly: true;
};

const markerName = '.gitzone-transfer-owner';

const inspectDirectory = async (target: string): Promise<GitTransferPathState> => {
  try {
    const stats = await fs.lstat(target);

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return 'UNSAFE';
    }

    return 'DIRECTORY';
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return 'MISSING';
    }

    throw error;
  }
};

const inspectMarker = async (directory: string, transferId: string): Promise<boolean> => {
  try {
    const marker = await fs.readFile(path.join(directory, markerName), 'utf8');

    return marker === transferId;
  } catch {
    return false;
  }
};

/**
 * Read-only recovery inspection.
 *
 * Does not delete, move, rename, or modify Git repositories.
 */
export const inspectGitRepositoryTransferRecovery = async (
  input: GitTransferRecoveryInput,
): Promise<GitTransferRecoveryInspection> => {
  if (!/^[a-z0-9]{20,40}$/.test(input.transferId)) {
    throw new Error('Invalid transfer journal identifier');
  }

  const sourcePath = resolveGitRepositoryPath(input.sourceUsername, input.repositoryName);

  const destinationPath = resolveOwnedGitRepositoryPath(
    {
      type: 'ORGANIZATION',
      slug: input.targetOrgSlug,
    },
    input.repositoryName,
  );

  const stagingPath = path.join(path.dirname(destinationPath), `.transfer-${input.transferId}`);

  const [source, staging, destination] = await Promise.all([
    inspectDirectory(sourcePath),
    inspectDirectory(stagingPath),
    inspectDirectory(destinationPath),
  ]);

  const [stagingOwnedByTransfer, destinationOwnedByTransfer] = await Promise.all([
    staging === 'DIRECTORY' ? inspectMarker(stagingPath, input.transferId) : false,
    destination === 'DIRECTORY' ? inspectMarker(destinationPath, input.transferId) : false,
  ]);

  const requiresManualRecovery =
    source !== 'DIRECTORY' ||
    staging === 'UNSAFE' ||
    destination === 'UNSAFE' ||
    (staging === 'DIRECTORY' && !stagingOwnedByTransfer) ||
    (destination === 'DIRECTORY' && !destinationOwnedByTransfer);

  return {
    source,
    staging,
    destination,
    destinationOwnedByTransfer,
    stagingOwnedByTransfer,
    requiresManualRecovery,
    safeToResumeAutomatically: false,
    inspectionOnly: true,
  };
};
