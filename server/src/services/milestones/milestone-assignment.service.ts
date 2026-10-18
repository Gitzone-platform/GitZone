import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { authorizeRepositoryAccess } from '../repositories/repository-authorization.service.js';

const resolveRepository = async (userId: string, username: string, repositoryName: string) => {
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

  await authorizeRepositoryAccess(repository.id, 'WRITE', userId);

  return repository;
};

const resolveMilestone = async (repositoryId: string, milestoneId: string) => {
  const milestone = await prisma.milestone.findFirst({
    where: {
      id: milestoneId,
      repositoryId,
    },
    select: { id: true },
  });

  if (!milestone) {
    throw new AppError('Milestone not found', 404, 'MILESTONE_NOT_FOUND');
  }

  return milestone;
};

const resolveIssue = async (repositoryId: string, number: number) => {
  const issue = await prisma.issue.findUnique({
    where: {
      repositoryId_number: {
        repositoryId,
        number,
      },
    },
    select: { id: true },
  });

  if (!issue) {
    throw new AppError('Issue not found', 404, 'ISSUE_NOT_FOUND');
  }

  return issue;
};

const resolvePullRequest = async (repositoryId: string, number: number) => {
  const pullRequest = await prisma.pullRequest.findUnique({
    where: {
      repositoryId_number: {
        repositoryId,
        number,
      },
    },
    select: { id: true },
  });

  if (!pullRequest) {
    throw new AppError('Pull request not found', 404, 'PULL_REQUEST_NOT_FOUND');
  }

  return pullRequest;
};

export const assignIssueMilestone = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  milestoneId: string | null,
) => {
  const repository = await resolveRepository(userId, username, repositoryName);

  const issue = await resolveIssue(repository.id, number);

  if (milestoneId !== null) {
    await resolveMilestone(repository.id, milestoneId);
  }

  const result = await prisma.issue.updateMany({
    where: {
      id: issue.id,
      repositoryId: repository.id,
    },
    data: {
      milestoneId,
    },
  });

  if (result.count !== 1) {
    throw new AppError('Issue not found', 404, 'ISSUE_NOT_FOUND');
  }

  return prisma.issue.findUniqueOrThrow({
    where: {
      id: issue.id,
      repositoryId: repository.id,
    },
    include: {
      milestone: true,
    },
  });
};

export const assignPullRequestMilestone = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  milestoneId: string | null,
) => {
  const repository = await resolveRepository(userId, username, repositoryName);

  const pullRequest = await resolvePullRequest(repository.id, number);

  if (milestoneId !== null) {
    await resolveMilestone(repository.id, milestoneId);
  }

  const result = await prisma.pullRequest.updateMany({
    where: {
      id: pullRequest.id,
      repositoryId: repository.id,
    },
    data: {
      milestoneId,
    },
  });

  if (result.count !== 1) {
    throw new AppError('Pull request not found', 404, 'PULL_REQUEST_NOT_FOUND');
  }

  return prisma.pullRequest.findUniqueOrThrow({
    where: {
      id: pullRequest.id,
      repositoryId: repository.id,
    },
    include: {
      milestone: true,
    },
  });
};
