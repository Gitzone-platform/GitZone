import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';

export const assertRepositoryTransferAllowsGitWrite = async (
  repositoryId: string,
): Promise<void> => {
  const activeTransfer = await prisma.repositoryTransfer.findFirst({
    where: {
      repositoryId,
      status: {
        in: ['PENDING', 'MOVING', 'MOVED'],
      },
    },
    select: {
      id: true,
    },
  });

  if (activeTransfer) {
    throw new AppError(
      'Repository transfer is in progress; Git writes are temporarily blocked',
      409,
      'GIT_REPOSITORY_TRANSFER_WRITE_BLOCKED',
    );
  }
};
