import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { authorizeRepositoryAccess } from './repository-authorization.service.js';
import type { RepositoryWatchPreferenceInput } from '../../validations/repositories/repository-watch-preferences.validation.js';

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
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
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
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
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
export const updateRepositoryWatchPreference = async (
  userId: string,
  username: string,
  name: string,
  preference: RepositoryWatchPreferenceInput,
): Promise<{
  repositoryId: string;
  watching: true;
  preference: RepositoryWatchPreferenceInput;
}> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name,
      owner: { username },
    },
    select: { id: true },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  const result = await prisma.repositoryWatch.updateMany({
    where: {
      userId,
      repositoryId: repository.id,
    },
    data: {
      preference,
    },
  });

  if (result.count === 0) {
    throw new AppError('Repository watch not found', 404, 'WATCH_NOT_FOUND');
  }

  return {
    repositoryId: repository.id,
    watching: true,
    preference,
  };
};

export const getRepositoryWatcherCount = async (
  username: string,
  name: string,
  userId?: string,
): Promise<{ repositoryId: string; watcherCount: number }> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name,
      owner: { username },
    },
    select: { id: true },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  const watcherCount = await prisma.repositoryWatch.count({
    where: {
      repositoryId: repository.id,
    },
  });

  return {
    repositoryId: repository.id,
    watcherCount,
  };
};
