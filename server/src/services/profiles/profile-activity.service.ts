import prisma from '../../config/prisma.js';
import { getPublicUserProfile } from './profile.service.js';
import type {
  ProfileActivity,
  ProfileActivityResponse,
} from '../../types/profile-activity.types.js';

const ACTIVITY_LIMIT = 30;

export const getUserPublicActivity = async (username: string): Promise<ProfileActivityResponse> => {
  const user = await getPublicUserProfile(username);

  const publicRepositoryFilter = {
    isPrivate: false,
  } as const;

  const [repositories, issues, pullRequests] = await Promise.all([
    prisma.repository.findMany({
      where: {
        ownerId: user.id,
        ...publicRepositoryFilter,
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: ACTIVITY_LIMIT,
    }),

    prisma.issue.findMany({
      where: {
        creatorId: user.id,
        repository: publicRepositoryFilter,
      },
      select: {
        id: true,
        number: true,
        title: true,
        createdAt: true,
        repository: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: ACTIVITY_LIMIT,
    }),

    prisma.pullRequest.findMany({
      where: {
        authorId: user.id,
        repository: publicRepositoryFilter,
      },
      select: {
        id: true,
        number: true,
        title: true,
        createdAt: true,
        repository: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: ACTIVITY_LIMIT,
    }),
  ]);

  const activities: ProfileActivity[] = [
    ...repositories.map((repository) => ({
      id: repository.id,
      type: 'REPOSITORY_CREATED' as const,
      repository: {
        id: repository.id,
        name: repository.name,
      },
      number: null,
      title: null,
      createdAt: repository.createdAt,
    })),

    ...issues.map((issue) => ({
      id: issue.id,
      type: 'ISSUE_CREATED' as const,
      repository: issue.repository,
      number: issue.number,
      title: issue.title,
      createdAt: issue.createdAt,
    })),

    ...pullRequests.map((pullRequest) => ({
      id: pullRequest.id,
      type: 'PULL_REQUEST_CREATED' as const,
      repository: pullRequest.repository,
      number: pullRequest.number,
      title: pullRequest.title,
      createdAt: pullRequest.createdAt,
    })),
  ];

  activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    activities: activities.slice(0, ACTIVITY_LIMIT),
  };
};
