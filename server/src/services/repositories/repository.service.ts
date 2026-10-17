import prisma from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../errors/app.error.js';
import {
  createGitRepository,
  finalizeStagedGitRepositoryDeletion,
  renameGitRepository,
  restoreStagedGitRepositoryDeletion,
  stageGitRepositoryDeletion,
} from '../git/git-repository.service.js';
import type {
  CreateRepositoryInput,
  UpdateRepositoryInput,
} from '../../validations/repositories/repository.validation.js';
import type { RepositoryResponse, RepositoryWithOwner } from '../../types/repository.types.js';

const toRepositoryResponse = (repository: {
  id: string;
  ownerId: string | null;
  name: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  createdAt: Date;
  updatedAt: Date;
}): RepositoryResponse => {
  if (!repository.ownerId) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }
  return {
    id: repository.id,
    ownerId: repository.ownerId,
    name: repository.name,
    description: repository.description,
    isPrivate: repository.isPrivate,
    defaultBranch: repository.defaultBranch,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  };
};

export const createRepository = async (
  ownerId: string,
  input: CreateRepositoryInput,
): Promise<RepositoryResponse> => {
  const existingRepository = await prisma.repository.findUnique({
    where: {
      ownerId_name: {
        ownerId,
        name: input.name,
      },
    },
  });

  if (existingRepository) {
    throw new AppError(
      'Repository with this name already exists',
      409,
      'REPOSITORY_ALREADY_EXISTS',
    );
  }

  const repository = await prisma.repository.create({
    data: {
      ownerId,
      name: input.name,
      description: input.description ?? null,
      isPrivate: input.isPrivate ?? false,
    },
  });

  try {
    const owner = await prisma.user.findUnique({
      where: {
        id: ownerId,
      },
      select: {
        username: true,
      },
    });

    if (!owner) {
      throw new AppError('Repository owner not found', 404, 'USER_NOT_FOUND');
    }

    await createGitRepository(owner.username, repository.name);
  } catch (error) {
    try {
      await prisma.repository.delete({
        where: {
          id: repository.id,
        },
      });
    } catch (rollbackError) {
      logger.error(
        {
          err: rollbackError,
          originalError: error,
          repositoryId: repository.id,
          ownerId,
          repositoryName: repository.name,
        },
        'Repository creation database rollback failed',
      );

      throw new AppError(
        'Repository creation failed and database rollback could not be completed',
        500,
        'REPOSITORY_CREATE_ROLLBACK_FAILED',
      );
    }

    throw error;
  }

  return toRepositoryResponse(repository);
};

export const getUserRepositories = async (username: string): Promise<RepositoryResponse[]> => {
  const repositories = await prisma.repository.findMany({
    where: {
      owner: {
        username,
      },
      organizationId: null,
      isPrivate: false,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return repositories.map(toRepositoryResponse);
};

export const getRepositoryByUsernameAndName = async (
  username: string,
  name: string,
): Promise<RepositoryWithOwner> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name,
      organizationId: null,
      isPrivate: false,
      owner: {
        username,
      },
    },
    include: {
      owner: {
        select: {
          id: true,
          username: true,
          name: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (!repository || !repository.ownerId || !repository.owner) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  return {
    id: repository.id,
    ownerId: repository.ownerId,
    name: repository.name,
    description: repository.description,
    isPrivate: repository.isPrivate,
    defaultBranch: repository.defaultBranch,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
    owner: repository.owner,
  };
};

export const updateRepository = async (
  ownerId: string,
  username: string,
  name: string,
  input: UpdateRepositoryInput,
): Promise<RepositoryResponse> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name,
      organizationId: null,
      owner: {
        username,
      },
    },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  if (repository.ownerId !== ownerId) {
    throw new AppError(
      'You do not have permission to modify this repository',
      403,
      'REPOSITORY_FORBIDDEN',
    );
  }

  const requestedName = input.name;

  let gitRepositoryRenamed = false;

  if (requestedName !== undefined && requestedName !== repository.name) {
    const existingRepository = await prisma.repository.findUnique({
      where: {
        ownerId_name: {
          ownerId,
          name: requestedName,
        },
      },
    });

    if (existingRepository) {
      throw new AppError(
        'Repository with this name already exists',
        409,
        'REPOSITORY_ALREADY_EXISTS',
      );
    }

    await renameGitRepository(username, repository.name, requestedName);

    gitRepositoryRenamed = true;
  }

  try {
    const updatedRepository = await prisma.repository.update({
      where: {
        id: repository.id,
      },
      data: {
        ...(requestedName !== undefined && {
          name: requestedName,
        }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.isPrivate !== undefined && {
          isPrivate: input.isPrivate,
        }),
      },
    });

    return toRepositoryResponse(updatedRepository);
  } catch (error) {
    if (gitRepositoryRenamed && requestedName !== undefined) {
      try {
        await renameGitRepository(username, requestedName, repository.name);
      } catch (rollbackError) {
        logger.error(
          {
            err: rollbackError,
            originalError: error,
            repositoryId: repository.id,
            username,
            oldRepositoryName: repository.name,
            newRepositoryName: requestedName,
          },
          'Repository rename filesystem rollback failed',
        );

        throw new AppError(
          'Repository update failed and Git repository rename rollback could not be completed',
          500,
          'REPOSITORY_RENAME_ROLLBACK_FAILED',
        );
      }
    }

    throw error;
  }
};

export const deleteRepository = async (
  ownerId: string,
  username: string,
  name: string,
): Promise<void> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name,
      organizationId: null,
      owner: {
        username,
      },
    },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  if (repository.ownerId !== ownerId) {
    throw new AppError(
      'You do not have permission to delete this repository',
      403,
      'REPOSITORY_FORBIDDEN',
    );
  }

  const stagedDeletion = await stageGitRepositoryDeletion(username, repository.name);

  try {
    await prisma.repository.delete({
      where: {
        id: repository.id,
      },
    });
  } catch (error) {
    if (stagedDeletion) {
      try {
        await restoreStagedGitRepositoryDeletion(stagedDeletion);
      } catch (rollbackError) {
        logger.error(
          {
            err: rollbackError,
            originalError: error,
            repositoryId: repository.id,
            username,
            repositoryName: repository.name,
          },
          'Repository deletion filesystem rollback failed',
        );

        throw new AppError(
          'Repository deletion failed and Git repository rollback could not be completed',
          500,
          'REPOSITORY_DELETE_ROLLBACK_FAILED',
        );
      }
    }

    throw error;
  }

  if (!stagedDeletion) {
    return;
  }

  try {
    await finalizeStagedGitRepositoryDeletion(stagedDeletion);
  } catch (cleanupError) {
    logger.error(
      {
        err: cleanupError,
        repositoryId: repository.id,
        username,
        repositoryName: repository.name,
        stagedRepositoryName: stagedDeletion.stagedRepositoryName,
      },
      'Repository deleted from database but staged Git repository cleanup failed',
    );
  }
};
