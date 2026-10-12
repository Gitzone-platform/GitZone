import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { authorizeRepositoryAccess } from './repository-authorization.service.js';

export const getRepositoryForkNetwork = async (
  username: string,
  name: string,
  userId?: string,
) => {
  const repository = await prisma.repository.findFirst({
    where: { name, owner: { username } },
    select: {
      id: true,
      name: true,
      ownerId: true,
      isPrivate: true,
      forkedFromId: true,
    },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  const parent = repository.forkedFromId
    ? await prisma.repository.findUnique({
        where: { id: repository.forkedFromId },
        select: {
          id: true,
          name: true,
          isPrivate: true,
          owner: { select: { username: true } },
        },
      })
    : null;

  let visibleParent = null;

  if (parent) {
    try {
      await authorizeRepositoryAccess(parent.id, 'READ', userId);
      visibleParent = {
        id: parent.id,
        name: parent.name,
        owner: parent.owner.username,
      };
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        (error.statusCode !== 403 && error.statusCode !== 404)
      ) {
        throw error;
      }
    }
  }

  const children = await prisma.repository.findMany({
    where: {
      forkedFromId: repository.id,
      ...(userId
        ? {
            OR: [
              { isPrivate: false },
              { ownerId: userId },
              { collaborators: { some: { userId } } },
            ],
          }
        : { isPrivate: false }),
    },
    select: {
      id: true,
      name: true,
      owner: { select: { username: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const visibleForkCount = await prisma.repository.count({
    where: {
      forkedFromId: repository.id,
      ...(userId
        ? {
            OR: [
              { isPrivate: false },
              { ownerId: userId },
              { collaborators: { some: { userId } } },
            ],
          }
        : { isPrivate: false }),
    },
  });

  return {
    repositoryId: repository.id,
    isFork: repository.forkedFromId !== null,
    parent: visibleParent,
    parentAccessible: repository.forkedFromId === null
      ? null
      : visibleParent !== null,
    forkCount: children.length,
    totalForkCount: visibleForkCount,
    forks: children.map((child) => ({
      id: child.id,
      name: child.name,
      owner: child.owner.username,
    })),
    hasMore: visibleForkCount > children.length,
  };
};
