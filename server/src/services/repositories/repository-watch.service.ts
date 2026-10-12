import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { authorizeRepositoryAccess } from './repository-authorization.service.js';

export const watchRepository = async (
  userId: string,
  username: string,
  name: string,
): Promise<{
  repositoryId: string;
  watching: true;
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
    throw new AppError(
      'Repository not found',
      404,
      'REPOSITORY_NOT_FOUND',
    );
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  await prisma.repositoryWatch.upsert({
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
    watching: true,
  };
};

export const unwatchRepository = async (
  userId: string,
  username: string,
  name: string,
): Promise<{
  repositoryId: string;
  watching: false;
}> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name,
      owner: { username },
    },
    select: { id: true },
  });

  if (!repository) {
    throw new AppError(
      'Repository not found',
      404,
      'REPOSITORY_NOT_FOUND',
    );
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  await prisma.repositoryWatch.deleteMany({
    where: {
      userId,
      repositoryId: repository.id,
    },
  });

  return {
    repositoryId: repository.id,
    watching: false,
  };
};
