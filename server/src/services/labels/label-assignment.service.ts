import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { isPrismaUniqueConstraintError } from '../../utils/prisma/errors.js';
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

const resolveLabel = async (repositoryId: string, labelId: string) => {
  const label = await prisma.label.findFirst({
    where: {
      id: labelId,
      repositoryId,
    },
  });

  if (!label) {
    throw new AppError('Label not found', 404, 'LABEL_NOT_FOUND');
  }

  return label;
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

const handleDuplicateAssignment = (error: unknown): never => {
  if (isPrismaUniqueConstraintError(error)) {
    throw new AppError('Label is already assigned', 409, 'LABEL_ALREADY_ASSIGNED');
  }

  throw error;
};

export const addIssueLabel = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  labelId: string,
) => {
  const repository = await resolveRepository(userId, username, repositoryName);
  const issue = await resolveIssue(repository.id, number);
  const label = await resolveLabel(repository.id, labelId);

  try {
    await prisma.issueLabel.create({
      data: {
        issueId: issue.id,
        labelId: label.id,
      },
    });
  } catch (error) {
    return handleDuplicateAssignment(error);
  }

  return label;
};

export const removeIssueLabel = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  labelId: string,
) => {
  const repository = await resolveRepository(userId, username, repositoryName);
  const issue = await resolveIssue(repository.id, number);
  await resolveLabel(repository.id, labelId);

  const result = await prisma.issueLabel.deleteMany({
    where: {
      issueId: issue.id,
      labelId,
    },
  });

  if (result.count === 0) {
    throw new AppError('Label is not assigned to this issue', 404, 'ISSUE_LABEL_NOT_FOUND');
  }
};

export const addPullRequestLabel = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  labelId: string,
) => {
  const repository = await resolveRepository(userId, username, repositoryName);
  const pullRequest = await resolvePullRequest(repository.id, number);
  const label = await resolveLabel(repository.id, labelId);

  try {
    await prisma.pullRequestLabel.create({
      data: {
        pullRequestId: pullRequest.id,
        labelId: label.id,
      },
    });
  } catch (error) {
    return handleDuplicateAssignment(error);
  }

  return label;
};

export const removePullRequestLabel = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  labelId: string,
) => {
  const repository = await resolveRepository(userId, username, repositoryName);
  const pullRequest = await resolvePullRequest(repository.id, number);
  await resolveLabel(repository.id, labelId);

  const result = await prisma.pullRequestLabel.deleteMany({
    where: {
      pullRequestId: pullRequest.id,
      labelId,
    },
  });

  if (result.count === 0) {
    throw new AppError(
      'Label is not assigned to this pull request',
      404,
      'PULL_REQUEST_LABEL_NOT_FOUND',
    );
  }
};
