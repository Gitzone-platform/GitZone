import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';

export type TransferState = 'PENDING' | 'MOVING' | 'MOVED' | 'COMPLETED' | 'FAILED';

export const authorizeRepositoryTransfer = async (
  repositoryId: string,
  actorId: string,
  targetOrgId: string,
): Promise<void> => {
  const [repository, membership] = await Promise.all([
    prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        ownerId: true,
        organizationId: true,
      },
    }),
    prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: targetOrgId,
          userId: actorId,
        },
      },
      select: { role: true },
    }),
  ]);

  if (!repository || repository.ownerId !== actorId || repository.organizationId !== null) {
    throw new AppError(
      'Only the personal repository owner can transfer it',
      403,
      'REPOSITORY_TRANSFER_NOT_OWNER',
    );
  }

  if (!membership || membership.role !== 'OWNER') {
    throw new AppError(
      'Organization OWNER permission is required',
      403,
      'REPOSITORY_TRANSFER_ORG_OWNER_REQUIRED',
    );
  }
};

const transitions: Record<TransferState, readonly TransferState[]> = {
  PENDING: ['MOVING', 'FAILED'],
  MOVING: ['MOVED', 'FAILED'],
  MOVED: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export const advanceRepositoryTransferState = async (
  transferId: string,
  expectedState: TransferState,
  nextState: TransferState,
): Promise<void> => {
  if (!transitions[expectedState].includes(nextState)) {
    throw new AppError(
      'Invalid repository transfer state transition',
      409,
      'REPOSITORY_TRANSFER_INVALID_TRANSITION',
    );
  }

  const result = await prisma.repositoryTransfer.updateMany({
    where: {
      id: transferId,
      status: expectedState,
    },
    data: {
      status: nextState,
      lastError: null,
    },
  });

  if (result.count !== 1) {
    throw new AppError(
      'Repository transfer state changed concurrently',
      409,
      'REPOSITORY_TRANSFER_STATE_CONFLICT',
    );
  }
};
