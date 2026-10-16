import type { RepositoryPermission } from '../../generated/prisma/enums.js';

import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';

export type RepositoryAccessType = 'READ' | 'WRITE';

type RepositoryAccessResult = {
  repositoryId: string;
  repositoryName: string;
  repositoryOwnerId: string;
  repositoryOwnerUsername: string;
  isPrivate: boolean;
  permission: 'OWNER' | RepositoryPermission | 'PUBLIC';
};

export const authorizeRepositoryAccess = async (
  repositoryId: string,
  accessType: RepositoryAccessType,
  userId?: string,
): Promise<RepositoryAccessResult> => {
  const repository = await prisma.repository.findUnique({
    where: {
      id: repositoryId,
    },
    select: {
      id: true,
      name: true,
      isPrivate: true,
      ownerId: true,
      organizationId: true,
      owner: {
        select: {
          username: true,
        },
      },
      collaborators: userId
        ? {
            where: {
              userId,
            },
            select: {
              permission: true,
            },
            take: 1,
          }
        : false,
    },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  if (repository.organizationId) {
    throw new AppError(
      'Organization repository requires organization authorization',
      403,
      'ORGANIZATION_REPOSITORY_AUTHORIZATION_REQUIRED',
    );
  }

  if (userId && repository.ownerId === userId) {
    return {
      repositoryId: repository.id,
      repositoryName: repository.name,
      repositoryOwnerId: repository.ownerId,
      repositoryOwnerUsername: repository.owner.username,
      isPrivate: repository.isPrivate,
      permission: 'OWNER',
    };
  }

  if (accessType === 'READ' && !repository.isPrivate) {
    return {
      repositoryId: repository.id,
      repositoryName: repository.name,
      repositoryOwnerId: repository.ownerId,
      repositoryOwnerUsername: repository.owner.username,
      isPrivate: repository.isPrivate,
      permission: 'PUBLIC',
    };
  }

  if (userId) {
    const collaborator = repository.collaborators[0];

    if (collaborator) {
      if (accessType === 'READ') {
        return {
          repositoryId: repository.id,
          repositoryName: repository.name,
          repositoryOwnerId: repository.ownerId,
          repositoryOwnerUsername: repository.owner.username,
          isPrivate: repository.isPrivate,
          permission: collaborator.permission,
        };
      }

      if (accessType === 'WRITE' && collaborator.permission === 'WRITE') {
        return {
          repositoryId: repository.id,
          repositoryName: repository.name,
          repositoryOwnerId: repository.ownerId,
          repositoryOwnerUsername: repository.owner.username,
          isPrivate: repository.isPrivate,
          permission: collaborator.permission,
        };
      }
    }
  }

  throw new AppError(
    'You do not have permission to access this repository',
    403,
    'REPOSITORY_ACCESS_DENIED',
  );
};
