import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import {
  assignIssueMilestone,
  assignPullRequestMilestone,
} from '../../../src/services/milestones/milestone-assignment.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: { findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    issue: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    pullRequest: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const findRepository = vi.mocked(prisma.repository.findFirst);
const authorize = vi.mocked(authorizeRepositoryAccess);
const findMilestone = vi.mocked(prisma.milestone.findFirst);

const findIssue = vi.mocked(prisma.issue.findUnique);
const updateIssue = vi.mocked(prisma.issue.updateMany);
const getUpdatedIssue = vi.mocked(prisma.issue.findUniqueOrThrow);

const findPullRequest = vi.mocked(prisma.pullRequest.findUnique);
const updatePullRequest = vi.mocked(prisma.pullRequest.updateMany);
const getUpdatedPullRequest = vi.mocked(prisma.pullRequest.findUniqueOrThrow);

const milestoneId = 'milestone-1';

describe('Milestone assignment service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findRepository.mockResolvedValue({ id: 'repo-1' } as never);
    authorize.mockResolvedValue(undefined as never);

    findMilestone.mockResolvedValue({ id: milestoneId } as never);

    findIssue.mockResolvedValue({ id: 'issue-1' } as never);
    updateIssue.mockResolvedValue({ count: 1 });
    getUpdatedIssue.mockResolvedValue({
      id: 'issue-1',
      milestoneId,
      milestone: { id: milestoneId },
    } as never);

    findPullRequest.mockResolvedValue({ id: 'pr-1' } as never);
    updatePullRequest.mockResolvedValue({ count: 1 });
    getUpdatedPullRequest.mockResolvedValue({
      id: 'pr-1',
      milestoneId,
      milestone: { id: milestoneId },
    } as never);
  });

  it('rejects a missing repository', async () => {
    findRepository.mockResolvedValue(null as never);

    await expect(
      assignIssueMilestone('user-1', 'owner', 'demo', 1, milestoneId),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it('requires WRITE permission for issue assignment', async () => {
    await assignIssueMilestone('user-1', 'owner', 'demo', 1, milestoneId);

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');
  });

  it('rejects issue assignment without WRITE permission', async () => {
    authorize.mockRejectedValue(
      Object.assign(new Error('Forbidden'), {
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );

    await expect(
      assignIssueMilestone('reader-1', 'owner', 'demo', 1, milestoneId),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it('rejects a missing issue', async () => {
    findIssue.mockResolvedValue(null);

    await expect(
      assignIssueMilestone('user-1', 'owner', 'demo', 99, milestoneId),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_NOT_FOUND',
    });

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it('rejects a foreign repository milestone for an issue', async () => {
    findMilestone.mockResolvedValue(null);

    await expect(
      assignIssueMilestone('user-1', 'owner', 'demo', 1, 'foreign-milestone'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'MILESTONE_NOT_FOUND',
    });

    expect(findMilestone).toHaveBeenCalledWith({
      where: {
        id: 'foreign-milestone',
        repositoryId: 'repo-1',
      },
      select: { id: true },
    });

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it('assigns an issue milestone scoped to repository', async () => {
    const result = await assignIssueMilestone('user-1', 'owner', 'demo', 1, milestoneId);

    expect(findIssue).toHaveBeenCalledWith({
      where: {
        repositoryId_number: {
          repositoryId: 'repo-1',
          number: 1,
        },
      },
      select: { id: true },
    });

    expect(updateIssue).toHaveBeenCalledWith({
      where: {
        id: 'issue-1',
        repositoryId: 'repo-1',
      },
      data: { milestoneId },
    });

    expect(result.milestoneId).toBe(milestoneId);
  });

  it('removes an issue milestone using null', async () => {
    await assignIssueMilestone('user-1', 'owner', 'demo', 1, null);

    expect(findMilestone).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith({
      where: {
        id: 'issue-1',
        repositoryId: 'repo-1',
      },
      data: { milestoneId: null },
    });
  });

  it('returns 404 when issue disappears before update', async () => {
    updateIssue.mockResolvedValue({ count: 0 });

    await expect(
      assignIssueMilestone('user-1', 'owner', 'demo', 1, milestoneId),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_NOT_FOUND',
    });

    expect(getUpdatedIssue).not.toHaveBeenCalled();
  });

  it('requires WRITE permission for pull request assignment', async () => {
    await assignPullRequestMilestone('user-1', 'owner', 'demo', 2, milestoneId);

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');
  });

  it('rejects a missing pull request', async () => {
    findPullRequest.mockResolvedValue(null);

    await expect(
      assignPullRequestMilestone('user-1', 'owner', 'demo', 99, milestoneId),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'PULL_REQUEST_NOT_FOUND',
    });

    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it('rejects a foreign repository milestone for a pull request', async () => {
    findMilestone.mockResolvedValue(null);

    await expect(
      assignPullRequestMilestone('user-1', 'owner', 'demo', 2, 'foreign-milestone'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'MILESTONE_NOT_FOUND',
    });

    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it('assigns a pull request milestone scoped to repository', async () => {
    const result = await assignPullRequestMilestone('user-1', 'owner', 'demo', 2, milestoneId);

    expect(findPullRequest).toHaveBeenCalledWith({
      where: {
        repositoryId_number: {
          repositoryId: 'repo-1',
          number: 2,
        },
      },
      select: { id: true },
    });

    expect(updatePullRequest).toHaveBeenCalledWith({
      where: {
        id: 'pr-1',
        repositoryId: 'repo-1',
      },
      data: { milestoneId },
    });

    expect(result.milestoneId).toBe(milestoneId);
  });

  it('removes a pull request milestone using null', async () => {
    await assignPullRequestMilestone('user-1', 'owner', 'demo', 2, null);

    expect(findMilestone).not.toHaveBeenCalled();
    expect(updatePullRequest).toHaveBeenCalledWith({
      where: {
        id: 'pr-1',
        repositoryId: 'repo-1',
      },
      data: { milestoneId: null },
    });
  });

  it('returns 404 when pull request disappears before update', async () => {
    updatePullRequest.mockResolvedValue({ count: 0 });

    await expect(
      assignPullRequestMilestone('user-1', 'owner', 'demo', 2, milestoneId),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'PULL_REQUEST_NOT_FOUND',
    });

    expect(getUpdatedPullRequest).not.toHaveBeenCalled();
  });
});
