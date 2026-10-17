import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { verifyGitRepositoryIntegrity } from '../git/git-repository-transfer-integrity.service.js';
import { resolveOwnedGitRepositoryPath } from '../../utils/git/repository-path.js';

export const switchRepositoryTransferOwnership = async (
  transferId: string,
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const transfer = await tx.repositoryTransfer.findUnique({
      where: { id: transferId },
    });

    if (!transfer || transfer.status !== 'MOVED') {
      throw new AppError(
        'Repository transfer is not ready for ownership switch',
        409,
        'REPOSITORY_TRANSFER_NOT_READY',
      );
    }

    const destinationPath = resolveOwnedGitRepositoryPath(
      { type: 'ORGANIZATION', slug: transfer.targetOrgSlug },
      transfer.repositoryName,
    );

    const integrity = await verifyGitRepositoryIntegrity(destinationPath);

    if (!integrity.valid) {
      throw new AppError(
        'Destination Git repository failed integrity verification',
        409,
        'REPOSITORY_TRANSFER_DESTINATION_INTEGRITY_FAILED',
      );
    }

    const repository = await tx.repository.findUnique({
      where: { id: transfer.repositoryId },
      select: {
        id: true,
        ownerId: true,
        organizationId: true,
        name: true,
      },
    });

    if (
      !repository ||
      repository.ownerId !== transfer.sourceOwnerId ||
      repository.organizationId !== null ||
      repository.name !== transfer.repositoryName
    ) {
      throw new AppError(
        'Repository ownership changed during transfer',
        409,
        'REPOSITORY_TRANSFER_SOURCE_CHANGED',
      );
    }

    const updated = await tx.repository.updateMany({
      where: {
        id: repository.id,
        ownerId: transfer.sourceOwnerId,
        organizationId: null,
        name: transfer.repositoryName,
      },
      data: {
        ownerId: null,
        organizationId: transfer.targetOrgId,
      },
    });

    if (updated.count !== 1) {
      throw new AppError(
        'Repository ownership switch conflict',
        409,
        'REPOSITORY_TRANSFER_OWNERSHIP_CONFLICT',
      );
    }

    const completed = await tx.repositoryTransfer.updateMany({
      where: {
        id: transferId,
        status: 'MOVED',
      },
      data: {
        status: 'COMPLETED',
      },
    });

    if (completed.count !== 1) {
      throw new AppError(
        'Repository transfer completion conflict',
        409,
        'REPOSITORY_TRANSFER_COMPLETION_CONFLICT',
      );
    }
  });
};
