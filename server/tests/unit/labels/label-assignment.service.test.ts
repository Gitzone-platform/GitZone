import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import {
  addIssueLabel,
  removeIssueLabel,
  addPullRequestLabel,
  removePullRequestLabel,
} from '../../../src/services/labels/label-assignment.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: { findFirst: vi.fn() },
    issue: { findUnique: vi.fn() },
    pullRequest: { findUnique: vi.fn() },
    label: { findFirst: vi.fn() },
    issueLabel: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    pullRequestLabel: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const findRepository = vi.mocked(prisma.repository.findFirst);
const findIssue = vi.mocked(prisma.issue.findUnique);
const findPullRequest = vi.mocked(prisma.pullRequest.findUnique);
const findLabel = vi.mocked(prisma.label.findFirst);

const createIssueAssignment = vi.mocked(prisma.issueLabel.create);
const deleteIssueAssignment = vi.mocked(prisma.issueLabel.deleteMany);

const createPullAssignment = vi.mocked(prisma.pullRequestLabel.create);
const deletePullAssignment = vi.mocked(prisma.pullRequestLabel.deleteMany);

const authorize = vi.mocked(authorizeRepositoryAccess);

const label = {
  id: 'label-1',
  repositoryId: 'repo-1',
  name: 'bug',
  color: '#FF5733',
  description: null,
  createdAt: new Date('2026-10-08T10:00:00Z'),
  updatedAt: new Date('2026-10-08T10:00:00Z'),
};

const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('Label assignment service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findRepository.mockResolvedValue({ id: 'repo-1' } as never);
    findIssue.mockResolvedValue({ id: 'issue-1' } as never);
    findPullRequest.mockResolvedValue({ id: 'pr-1' } as never);
    findLabel.mockResolvedValue(label);

    authorize.mockResolvedValue(undefined as never);

    createIssueAssignment.mockResolvedValue({} as never);
    createPullAssignment.mockResolvedValue({} as never);

    deleteIssueAssignment.mockResolvedValue({ count: 1 });
    deletePullAssignment.mockResolvedValue({ count: 1 });
  });

  it('rejects missing repository', async () => {
    findRepository.mockResolvedValue(null as never);

    await expect(addIssueLabel('user-1', 'owner', 'demo', 1, 'label-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(authorize).not.toHaveBeenCalled();
    expect(createIssueAssignment).not.toHaveBeenCalled();
  });

  it('requires WRITE permission for issue labels', async () => {
    await addIssueLabel('user-1', 'owner', 'demo', 1, 'label-1');

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');
  });

  it('rejects unauthorized issue label assignment', async () => {
    authorize.mockRejectedValue(
      Object.assign(new Error('Forbidden'), {
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );

    await expect(addIssueLabel('user-1', 'owner', 'demo', 1, 'label-1')).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(createIssueAssignment).not.toHaveBeenCalled();
  });

  it('adds a label to an issue', async () => {
    const result = await addIssueLabel('user-1', 'owner', 'demo', 7, 'label-1');

    expect(result).toEqual(label);

    expect(findIssue).toHaveBeenCalledWith({
      where: {
        repositoryId_number: {
          repositoryId: 'repo-1',
          number: 7,
        },
      },
      select: { id: true },
    });

    expect(createIssueAssignment).toHaveBeenCalledWith({
      data: {
        issueId: 'issue-1',
        labelId: 'label-1',
      },
    });
  });

  it('rejects missing issue', async () => {
    findIssue.mockResolvedValue(null as never);

    await expect(addIssueLabel('user-1', 'owner', 'demo', 999, 'label-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_NOT_FOUND',
    });

    expect(createIssueAssignment).not.toHaveBeenCalled();
  });

  it('rejects labels outside the issue repository', async () => {
    findLabel.mockResolvedValue(null as never);

    await expect(
      addIssueLabel('user-1', 'owner', 'demo', 1, 'foreign-label'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'LABEL_NOT_FOUND',
    });

    expect(findLabel).toHaveBeenCalledWith({
      where: {
        id: 'foreign-label',
        repositoryId: 'repo-1',
      },
    });

    expect(createIssueAssignment).not.toHaveBeenCalled();
  });

  it('rejects duplicate issue label assignment', async () => {
    createIssueAssignment.mockRejectedValue(uniqueError());

    await expect(addIssueLabel('user-1', 'owner', 'demo', 1, 'label-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'LABEL_ALREADY_ASSIGNED',
    });
  });

  it('removes a label from an issue', async () => {
    await removeIssueLabel('user-1', 'owner', 'demo', 1, 'label-1');

    expect(deleteIssueAssignment).toHaveBeenCalledWith({
      where: {
        issueId: 'issue-1',
        labelId: 'label-1',
      },
    });
  });

  it('rejects removal of a label not assigned to an issue', async () => {
    deleteIssueAssignment.mockResolvedValue({ count: 0 });

    await expect(removeIssueLabel('user-1', 'owner', 'demo', 1, 'label-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_LABEL_NOT_FOUND',
    });
  });

  it('rejects removal of a foreign repository label from an issue', async () => {
    findLabel.mockResolvedValue(null as never);

    await expect(
      removeIssueLabel('user-1', 'owner', 'demo', 1, 'foreign-label'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'LABEL_NOT_FOUND',
    });

    expect(deleteIssueAssignment).not.toHaveBeenCalled();
  });

  it('adds a label to a pull request', async () => {
    const result = await addPullRequestLabel('user-1', 'owner', 'demo', 3, 'label-1');

    expect(result).toEqual(label);

    expect(findPullRequest).toHaveBeenCalledWith({
      where: {
        repositoryId_number: {
          repositoryId: 'repo-1',
          number: 3,
        },
      },
      select: { id: true },
    });

    expect(createPullAssignment).toHaveBeenCalledWith({
      data: {
        pullRequestId: 'pr-1',
        labelId: 'label-1',
      },
    });

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');
  });

  it('rejects missing pull request', async () => {
    findPullRequest.mockResolvedValue(null as never);

    await expect(
      addPullRequestLabel('user-1', 'owner', 'demo', 999, 'label-1'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'PULL_REQUEST_NOT_FOUND',
    });

    expect(createPullAssignment).not.toHaveBeenCalled();
  });

  it('rejects labels outside the pull request repository', async () => {
    findLabel.mockResolvedValue(null as never);

    await expect(
      addPullRequestLabel('user-1', 'owner', 'demo', 1, 'foreign-label'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'LABEL_NOT_FOUND',
    });

    expect(createPullAssignment).not.toHaveBeenCalled();
  });

  it('rejects duplicate pull request label assignment', async () => {
    createPullAssignment.mockRejectedValue(uniqueError());

    await expect(
      addPullRequestLabel('user-1', 'owner', 'demo', 1, 'label-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'LABEL_ALREADY_ASSIGNED',
    });
  });

  it('removes a label from a pull request', async () => {
    await removePullRequestLabel('user-1', 'owner', 'demo', 1, 'label-1');

    expect(deletePullAssignment).toHaveBeenCalledWith({
      where: {
        pullRequestId: 'pr-1',
        labelId: 'label-1',
      },
    });
  });

  it('rejects removal of an unassigned pull request label', async () => {
    deletePullAssignment.mockResolvedValue({ count: 0 });

    await expect(
      removePullRequestLabel('user-1', 'owner', 'demo', 1, 'label-1'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'PULL_REQUEST_LABEL_NOT_FOUND',
    });
  });

  it('rejects removal of a foreign pull request label', async () => {
    findLabel.mockResolvedValue(null as never);

    await expect(
      removePullRequestLabel('user-1', 'owner', 'demo', 1, 'foreign-label'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'LABEL_NOT_FOUND',
    });

    expect(deletePullAssignment).not.toHaveBeenCalled();
  });

  it('requires WRITE permission to remove pull request labels', async () => {
    await removePullRequestLabel('user-1', 'owner', 'demo', 1, 'label-1');

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');
  });
});
