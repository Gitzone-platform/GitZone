import type { Prisma } from '../../generated/prisma/client.js';

import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { isPrismaUniqueConstraintError } from '../../utils/prisma/errors.js';
import { authorizeRepositoryAccess } from '../repositories/repository-authorization.service.js';

const assigneeInclude = {
  user: {
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
    },
  },
} satisfies Prisma.IssueAssigneeInclude;

const resolveIssue = async (
  username: string,
  repositoryName: string,
  number: number,
  userId: string | undefined,
  access: 'READ' | 'WRITE',
) => {
  const repository = await prisma.repository.findFirst({
    where: {
      name: repositoryName,
      owner: { username },
    },
    select: {
      id: true,
      ownerId: true,
    },
  });

  if (!repository) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  await authorizeRepositoryAccess(repository.id, access, userId);

  const issue = await prisma.issue.findUnique({
    where: {
      repositoryId_number: {
        repositoryId: repository.id,
        number,
      },
    },
    select: { id: true },
  });

  if (!issue) {
    throw new AppError('Issue not found', 404, 'ISSUE_NOT_FOUND');
  }

  return { repository, issue };
};

export const addIssueAssignee = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  assigneeUsername: string,
) => {
  const { repository, issue } = await resolveIssue(
    username,
    repositoryName,
    number,
    userId,
    'WRITE',
  );

  const assignee = await prisma.user.findUnique({
    where: { username: assigneeUsername },
    select: { id: true },
  });

  if (!assignee) {
    throw new AppError('Assignee user not found', 404, 'ISSUE_ASSIGNEE_USER_NOT_FOUND');
  }

  if (assignee.id !== repository.ownerId) {
    const collaborator = await prisma.repositoryCollaborator.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId: repository.id,
          userId: assignee.id,
        },
      },
      select: { id: true },
    });

    if (!collaborator) {
      throw new AppError(
        'Assignee must be a repository owner or collaborator',
        403,
        'ISSUE_ASSIGNEE_NOT_ELIGIBLE',
      );
    }
  }

  try {
    return await prisma.issueAssignee.create({
      data: {
        issueId: issue.id,
        userId: assignee.id,
      },
      include: assigneeInclude,
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new AppError(
        'User is already assigned to this issue',
        409,
        'ISSUE_ASSIGNEE_ALREADY_EXISTS',
      );
    }

    throw error;
  }
};

export const listIssueAssignees = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
) => {
  const { issue } = await resolveIssue(username, repositoryName, number, userId, 'READ');

  return prisma.issueAssignee.findMany({
    where: { issueId: issue.id },
    include: assigneeInclude,
    orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }],
  });
};

export const removeIssueAssignee = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  assigneeUsername: string,
) => {
  const { issue } = await resolveIssue(username, repositoryName, number, userId, 'WRITE');

  const assignee = await prisma.user.findUnique({
    where: { username: assigneeUsername },
    select: { id: true },
  });

  if (!assignee) {
    throw new AppError('Issue assignee not found', 404, 'ISSUE_ASSIGNEE_NOT_FOUND');
  }

  const result = await prisma.issueAssignee.deleteMany({
    where: {
      issueId: issue.id,
      userId: assignee.id,
    },
  });

  if (result.count === 0) {
    throw new AppError('Issue assignee not found', 404, 'ISSUE_ASSIGNEE_NOT_FOUND');
  }
};
