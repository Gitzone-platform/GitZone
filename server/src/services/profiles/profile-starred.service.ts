import type { Prisma } from '../../generated/prisma/client.js';

import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import type { ProfileStarredQuery } from '../../validations/profiles/profile-starred.validation.js';

export const getUserStarredRepositories = async (
  username: string,
  viewerId: string | undefined,
  query: ProfileStarredQuery,
) => {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });

  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const visibleRepository: Prisma.RepositoryWhereInput = {
    OR: [
      { isPrivate: false },
      ...(viewerId
        ? [
            { ownerId: viewerId },
            {
              collaborators: {
                some: { userId: viewerId },
              },
            },
          ]
        : []),
    ],
  };

  const where: Prisma.RepositoryStarWhereInput = {
    userId: user.id,
    repository: {
      is: visibleRepository,
    },
  };

  const [stars, total] = await prisma.$transaction([
    prisma.repositoryStar.findMany({
      where,
      select: {
        createdAt: true,
        repository: {
          select: {
            id: true,
            name: true,
            description: true,
            isPrivate: true,
            defaultBranch: true,
            createdAt: true,
            updatedAt: true,
            owner: {
              select: {
                id: true,
                username: true,
                name: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.repositoryStar.count({ where }),
  ]);

  return {
    repositories: stars.map((star) => ({
      ...star.repository,
      starredAt: star.createdAt,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
};
