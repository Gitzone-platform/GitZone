import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { authorizeRepositoryAccess } from './repository-authorization.service.js';

export const starRepository = async (
  userId: string,
  username: string,
  name: string,
): Promise<{
  repositoryId: string;
  starred: true;
}> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name,
      owner: {
        username,
      },
    },
    select: {
      id: true,
    },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  await prisma.repositoryStar.upsert({
    where: {
      userId_repositoryId: {
        userId,
        repositoryId: repository.id,
      },
    },
    create: {
      userId,
      repositoryId: repository.id,
    },
    update: {},
  });

  return {
    repositoryId: repository.id,
    starred: true,
  };
};

export const unstarRepository = async (
  userId: string,
  username: string,
  name: string,
): Promise<{
  repositoryId: string;
  starred: false;
}> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name,
      owner: {
        username,
      },
    },
    select: {
      id: true,
    },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  await prisma.repositoryStar.deleteMany({
    where: {
      userId,
      repositoryId: repository.id,
    },
  });

  return {
    repositoryId: repository.id,
    starred: false,
  };
};

export const getRepositoryStarCount = async (
  username: string,
  name: string,
  userId?: string,
): Promise<{
  repositoryId: string;
  starCount: number;
}> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name,
      owner: {
        username,
      },
    },
    select: {
      id: true,
    },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  const starCount = await prisma.repositoryStar.count({
    where: {
      repositoryId: repository.id,
    },
  });

  return {
    repositoryId: repository.id,
    starCount,
  };
};
