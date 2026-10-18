import prisma from '../../config/prisma.js';
import { calculateMilestonesProgress } from './milestone-batch-progress.service.js';
import { calculateMilestoneProgress } from './milestone-progress.service.js';
import { AppError } from '../../errors/app.error.js';
import { isPrismaUniqueConstraintError } from '../../utils/prisma/errors.js';
import { authorizeRepositoryAccess } from '../repositories/repository-authorization.service.js';

import type {
  CreateMilestoneInput,
  ListMilestonesQuery,
  UpdateMilestoneInput,
} from '../../validations/milestones/milestone.validation.js';

type Access = 'READ' | 'WRITE';

const resolveRepository = async (
  username: string,
  repositoryName: string,
  userId: string | undefined,
  access: Access,
) => {
  const repository = await prisma.repository.findFirst({
    where: {
      name: repositoryName,
      owner: { username },
    },
    select: { id: true },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, access, userId);

  return repository;
};

const resolveMilestone = async (repositoryId: string, milestoneId: string) => {
  const milestone = await prisma.milestone.findFirst({
    where: {
      id: milestoneId,
      repositoryId,
    },
  });

  if (!milestone) {
    throw new AppError('Milestone not found', 404, 'MILESTONE_NOT_FOUND');
  }

  return milestone;
};

const handleMilestoneError = (error: unknown): never => {
  if (isPrismaUniqueConstraintError(error)) {
    throw new AppError(
      'A milestone with this title already exists',
      409,
      'MILESTONE_ALREADY_EXISTS',
    );
  }

  throw error;
};

export const createMilestone = async (
  userId: string,
  username: string,
  repositoryName: string,
  input: CreateMilestoneInput,
) => {
  const repository = await resolveRepository(username, repositoryName, userId, 'WRITE');

  try {
    return await prisma.milestone.create({
      data: {
        repositoryId: repository.id,
        title: input.title,
        description: input.description ?? null,
        dueDate: input.dueDate ?? null,
      },
    });
  } catch (error) {
    return handleMilestoneError(error);
  }
};

export const listMilestones = async (
  username: string,
  repositoryName: string,
  query: ListMilestonesQuery,
  userId?: string,
) => {
  const repository = await resolveRepository(username, repositoryName, userId, 'READ');

  const where = {
    repositoryId: repository.id,
    ...(query.state !== undefined && {
      state: query.state,
    }),
  };

  const [milestones, total] = await prisma.$transaction([
    prisma.milestone.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.milestone.count({ where }),
  ]);

  const progressByMilestone = await calculateMilestonesProgress(
    repository.id,
    milestones.map((milestone) => milestone.id),
  );

  return {
    milestones: milestones.map((milestone) => {
      const progress = progressByMilestone.get(milestone.id);

      if (!progress) {
        throw new Error('Milestone progress result is missing');
      }

      return {
        ...milestone,
        progress,
      };
    }),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
};

export const getMilestone = async (
  username: string,
  repositoryName: string,
  milestoneId: string,
  userId?: string,
) => {
  const repository = await resolveRepository(username, repositoryName, userId, 'READ');

  const milestone = await resolveMilestone(repository.id, milestoneId);

  const progress = await calculateMilestoneProgress(repository.id, milestone.id);

  return {
    ...milestone,
    progress,
  };
};

export const updateMilestone = async (
  userId: string,
  username: string,
  repositoryName: string,
  milestoneId: string,
  input: UpdateMilestoneInput,
) => {
  const repository = await resolveRepository(username, repositoryName, userId, 'WRITE');

  const existing = await resolveMilestone(repository.id, milestoneId);

  const stateChanged = input.state !== undefined && input.state !== existing.state;

  try {
    return await prisma.milestone.update({
      where: {
        id: milestoneId,
        repositoryId: repository.id,
      },
      data: {
        ...(input.title !== undefined && {
          title: input.title,
        }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.dueDate !== undefined && {
          dueDate: input.dueDate,
        }),
        ...(input.state !== undefined && {
          state: input.state,
        }),
        ...(stateChanged && {
          closedAt: input.state === 'CLOSED' ? new Date() : null,
        }),
      },
    });
  } catch (error) {
    return handleMilestoneError(error);
  }
};

export const deleteMilestone = async (
  userId: string,
  username: string,
  repositoryName: string,
  milestoneId: string,
) => {
  const repository = await resolveRepository(username, repositoryName, userId, 'WRITE');

  await resolveMilestone(repository.id, milestoneId);

  await prisma.$transaction(async (tx) => {
    await tx.issue.updateMany({
      where: {
        repositoryId: repository.id,
        milestoneId,
      },
      data: {
        milestoneId: null,
      },
    });

    await tx.pullRequest.updateMany({
      where: {
        repositoryId: repository.id,
        milestoneId,
      },
      data: {
        milestoneId: null,
      },
    });

    await tx.milestone.delete({
      where: {
        id: milestoneId,
        repositoryId: repository.id,
      },
    });
  });
};
