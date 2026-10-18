import type { Prisma } from '../../generated/prisma/client.js';

import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { authorizeRepositoryAccess } from '../repositories/repository-authorization.service.js';

import type { CreateIssueInput } from '../../validations/issues/issue.validation.js';

const issueInclude = {
  creator: {
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
    },
  },
  labels: {
    include: {
      label: true,
    },
  },
  milestone: {
    select: {
      id: true,
      repositoryId: true,
      title: true,
      description: true,
      state: true,
      dueDate: true,
      closedAt: true,
    },
  },
} satisfies Prisma.IssueInclude;

export const createIssue = async (
  userId: string,
  username: string,
  repositoryName: string,
  input: CreateIssueInput,
) => {
  const repository = await prisma.repository.findFirst({
    where: {
      name: repositoryName,
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

  await authorizeRepositoryAccess(repository.id, 'WRITE', userId);

  return prisma.$transaction(async (tx) => {
    const counter = await tx.repositoryIssueCounter.upsert({
      where: {
        repositoryId: repository.id,
      },
      create: {
        repositoryId: repository.id,
        nextNumber: 2,
      },
      update: {
        nextNumber: {
          increment: 1,
        },
      },
    });

    const number = counter.nextNumber - 1;

    return tx.issue.create({
      data: {
        repositoryId: repository.id,
        number,
        creatorId: userId,
        title: input.title,
        body: input.body ?? null,
      },
      include: issueInclude,
    });
  });
};

export const listIssues = async (
  username: string,
  repositoryName: string,
  userId: string | undefined,
  query: import('../../validations/issues/issue.validation.js').ListIssuesQuery,
) => {
  const repository = await prisma.repository.findFirst({
    where: { name: repositoryName, owner: { username } },
    select: { id: true },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  const where = {
    repositoryId: repository.id,
    ...(query.state && { state: query.state }),
  };

  const [issues, total] = await prisma.$transaction([
    prisma.issue.findMany({
      where,
      include: issueInclude,
      orderBy: { number: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.issue.count({ where }),
  ]);

  return {
    issues,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
};

export const getIssue = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
) => {
  const repository = await prisma.repository.findFirst({
    where: { name: repositoryName, owner: { username } },
    select: { id: true },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  const issue = await prisma.issue.findUnique({
    where: {
      repositoryId_number: {
        repositoryId: repository.id,
        number,
      },
    },
    include: issueInclude,
  });

  if (!issue) {
    throw new AppError('Issue not found', 404, 'ISSUE_NOT_FOUND');
  }

  return issue;
};

export const updateIssue = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  input: import('../../validations/issues/issue.validation.js').UpdateIssueInput,
) => {
  const repository = await prisma.repository.findFirst({
    where: { name: repositoryName, owner: { username } },
    select: { id: true },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, 'WRITE', userId);

  const existing = await prisma.issue.findUnique({
    where: {
      repositoryId_number: {
        repositoryId: repository.id,
        number,
      },
    },
    select: { id: true },
  });

  if (!existing) {
    throw new AppError('Issue not found', 404, 'ISSUE_NOT_FOUND');
  }

  return prisma.issue.update({
    where: { id: existing.id },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.body !== undefined && { body: input.body }),
      ...(input.state !== undefined && {
        state: input.state,
        closedAt: input.state === 'CLOSED' ? new Date() : null,
      }),
    },
    include: issueInclude,
  });
};
