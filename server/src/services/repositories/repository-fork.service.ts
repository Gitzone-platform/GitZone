import prisma from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../errors/app.error.js';
import { cloneBareGitRepositoryForFork } from '../git/git-fork.service.js';
import { authorizeRepositoryAccess } from './repository-authorization.service.js';
import type { ForkRepositoryInput } from '../../validations/repositories/repository-fork.validation.js';

export const forkRepository = async (
  userId: string,
  sourceUsername: string,
  sourceRepositoryName: string,
  input: ForkRepositoryInput,
) => {
  const source = await prisma.repository.findFirst({
    where: {
      name: sourceRepositoryName,
      owner: { username: sourceUsername },
    },
  });

  if (!source) {
    throw new AppError('Source repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  const access = await authorizeRepositoryAccess(source.id, 'READ', userId);

  const targetOwner = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });

  if (!targetOwner) {
    throw new AppError('Fork owner not found', 404, 'USER_NOT_FOUND');
  }

  if (access.isPrivate && input.isPrivate === false) {
    throw new AppError(
      'Private repository cannot be forked as public',
      403,
      'FORK_VISIBILITY_DENIED',
    );
  }

  const targetName = input.name ?? source.name;

  if (
    targetOwner.username === access.repositoryOwnerUsername &&
    targetName === source.name
  ) {
    throw new AppError(
      'Cannot fork repository into itself',
      409,
      'FORK_SELF_COLLISION',
    );
  }

  const existing = await prisma.repository.findUnique({
    where: {
      ownerId_name: {
        ownerId: userId,
        name: targetName,
      },
    },
  });

  if (existing) {
    throw new AppError(
      'Repository with this name already exists',
      409,
      'REPOSITORY_ALREADY_EXISTS',
    );
  }

  const repository = await prisma.repository.create({
    data: {
      ownerId: userId,
      name: targetName,
      description: input.description ?? source.description,
      isPrivate: input.isPrivate ?? source.isPrivate,
      defaultBranch: source.defaultBranch,
      forkedFromId: source.id,
    },
  });

  try {
    await cloneBareGitRepositoryForFork(
      access.repositoryOwnerUsername,
      source.name,
      targetOwner.username,
      repository.name,
    );
  } catch (error) {
    try {
      await prisma.repository.delete({
        where: { id: repository.id },
      });
    } catch (rollbackError) {
      logger.error(
        {
          err: rollbackError,
          originalError: error,
          repositoryId: repository.id,
        },
        'Fork repository database rollback failed',
      );

      throw new AppError(
        'Fork creation failed and database rollback failed',
        500,
        'FORK_ROLLBACK_FAILED',
      );
    }

    throw error;
  }

  return {
    id: repository.id,
    ownerId: repository.ownerId,
    name: repository.name,
    description: repository.description,
    isPrivate: repository.isPrivate,
    defaultBranch: repository.defaultBranch,
    forkedFromId: repository.forkedFromId,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  };
};
