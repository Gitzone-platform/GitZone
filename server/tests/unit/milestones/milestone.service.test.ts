import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { calculateMilestoneProgress } from '../../../src/services/milestones/milestone-progress.service.js';
import { calculateMilestonesProgress } from '../../../src/services/milestones/milestone-batch-progress.service.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import {
  createMilestone,
  listMilestones,
  getMilestone,
  updateMilestone,
  deleteMilestone,
} from '../../../src/services/milestones/milestone.service.js';

vi.mock('../../../src/services/milestones/milestone-progress.service.js', () => ({
  calculateMilestoneProgress: vi.fn(),
}));
vi.mock('../../../src/services/milestones/milestone-batch-progress.service.js', () => ({
  calculateMilestonesProgress: vi.fn(),
}));
vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: vi.fn(),
    },
    milestone: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    issue: {
      updateMany: vi.fn(),
    },
    pullRequest: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const mockedProgress = vi.mocked(calculateMilestoneProgress);
const mockedBatchProgress = vi.mocked(calculateMilestonesProgress);
const findRepository = vi.mocked(prisma.repository.findFirst);
const authorize = vi.mocked(authorizeRepositoryAccess);

const createRecord = vi.mocked(prisma.milestone.create);
const findRecords = vi.mocked(prisma.milestone.findMany);
const countRecords = vi.mocked(prisma.milestone.count);
const findRecord = vi.mocked(prisma.milestone.findFirst);
const updateRecord = vi.mocked(prisma.milestone.update);
const deleteRecord = vi.mocked(prisma.milestone.delete);
const transaction = vi.mocked(prisma.$transaction);

const milestone = {
  id: 'milestone-1',
  repositoryId: 'repo-1',
  title: 'Version 1.0',
  description: 'First release',
  state: 'OPEN' as const,
  dueDate: new Date('2026-12-31T13:00:00Z'),
  closedAt: null,
  createdAt: new Date('2026-10-08T10:00:00Z'),
  updatedAt: new Date('2026-10-08T10:00:00Z'),
};

const duplicateError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
  });

describe('Milestone service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedProgress.mockResolvedValue({
      totalIssues: 0,
      closedIssues: 0,
      totalPullRequests: 0,
      completedPullRequests: 0,
      totalItems: 0,
      completedItems: 0,
      openItems: 0,
      percentage: 0,
    });
    mockedBatchProgress.mockResolvedValue(
      new Map([
        [
          'milestone-1',
          {
            totalIssues: 0,
            closedIssues: 0,
            totalPullRequests: 0,
            completedPullRequests: 0,
            totalItems: 0,
            completedItems: 0,
            openItems: 0,
            percentage: 0,
          },
        ],
      ]),
    );
    findRepository.mockResolvedValue({ id: 'repo-1' } as never);
    authorize.mockResolvedValue(undefined as never);

    createRecord.mockResolvedValue(milestone);
    findRecords.mockResolvedValue([milestone]);
    countRecords.mockResolvedValue(1);
    findRecord.mockResolvedValue(milestone);
    updateRecord.mockResolvedValue(milestone);
    deleteRecord.mockResolvedValue(milestone);

    transaction.mockImplementation(async (operations: unknown) => {
      if (typeof operations === 'function') {
        return (await operations(prisma)) as never;
      }

      return Promise.all(operations as Promise<unknown>[]) as never;
    });
  });

  it('returns 404 when repository does not exist', async () => {
    findRepository.mockResolvedValue(null as never);

    await expect(
      createMilestone('user-1', 'owner', 'demo', {
        title: 'Version 1.0',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(authorize).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('creates a milestone with WRITE permission', async () => {
    const result = await createMilestone('user-1', 'owner', 'demo', {
      title: 'Version 1.0',
      description: 'First release',
      dueDate: milestone.dueDate,
    });

    expect(result).toEqual(milestone);

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');

    expect(createRecord).toHaveBeenCalledWith({
      data: {
        repositoryId: 'repo-1',
        title: 'Version 1.0',
        description: 'First release',
        dueDate: milestone.dueDate,
      },
    });
  });

  it('defaults optional fields to null', async () => {
    await createMilestone('user-1', 'owner', 'demo', {
      title: 'Version 2.0',
    });

    expect(createRecord).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: null,
        dueDate: null,
      }),
    });
  });

  it('rejects creation without WRITE permission', async () => {
    authorize.mockRejectedValue(
      Object.assign(new Error('Forbidden'), {
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );

    await expect(
      createMilestone('reader-1', 'owner', 'demo', {
        title: 'Version 1.0',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(createRecord).not.toHaveBeenCalled();
  });

  it('rejects duplicate title creation with 409', async () => {
    createRecord.mockRejectedValue(duplicateError());

    await expect(
      createMilestone('user-1', 'owner', 'demo', {
        title: 'Version 1.0',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'MILESTONE_ALREADY_EXISTS',
    });
  });

  it('lists milestones with READ permission and pagination', async () => {
    const result = await listMilestones('owner', 'demo', {
      page: 2,
      limit: 5,
    });

    expect(authorize).toHaveBeenCalledWith('repo-1', 'READ', undefined);

    expect(findRecords).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repo-1',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 5,
      take: 5,
    });

    expect(countRecords).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repo-1',
      },
    });

    expect(result).toEqual({
      milestones: [
        {
          ...milestone,
          progress: {
            totalIssues: 0,
            closedIssues: 0,
            totalPullRequests: 0,
            completedPullRequests: 0,
            totalItems: 0,
            completedItems: 0,
            openItems: 0,
            percentage: 0,
          },
        },
      ],
      pagination: {
        page: 2,
        limit: 5,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('filters milestones by CLOSED state', async () => {
    await listMilestones(
      'owner',
      'demo',
      {
        state: 'CLOSED',
        page: 1,
        limit: 20,
      },
      'user-1',
    );

    expect(findRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId: 'repo-1',
          state: 'CLOSED',
        },
      }),
    );

    expect(countRecords).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repo-1',
        state: 'CLOSED',
      },
    });
  });

  it('requests batch progress using the authorized repository and page IDs', async () => {
    await listMilestones('owner', 'demo', { page: 1, limit: 20 }, 'user-1');

    expect(authorize).toHaveBeenCalledWith('repo-1', 'READ', 'user-1');

    expect(mockedBatchProgress).toHaveBeenCalledExactlyOnceWith('repo-1', ['milestone-1']);
  });

  it('returns an empty milestone page without incorrect progress data', async () => {
    findRecords.mockResolvedValue([]);
    countRecords.mockResolvedValue(0);
    mockedBatchProgress.mockResolvedValue(new Map());

    const result = await listMilestones('owner', 'demo', { page: 1, limit: 20 });

    expect(result).toEqual({
      milestones: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    });

    expect(mockedBatchProgress).toHaveBeenCalledExactlyOnceWith('repo-1', []);
  });

  it('rejects a missing batch progress result instead of returning incomplete data', async () => {
    mockedBatchProgress.mockResolvedValue(new Map());

    await expect(listMilestones('owner', 'demo', { page: 1, limit: 20 })).rejects.toThrow(
      'Milestone progress result is missing',
    );
  });

  it('assigns independent progress to each milestone', async () => {
    const secondMilestone = {
      ...milestone,
      id: 'milestone-2',
      title: 'Version 2.0',
    };

    findRecords.mockResolvedValue([milestone, secondMilestone]);

    countRecords.mockResolvedValue(2);

    const emptyProgress = {
      totalIssues: 0,
      closedIssues: 0,
      totalPullRequests: 0,
      completedPullRequests: 0,
      totalItems: 0,
      completedItems: 0,
      openItems: 0,
      percentage: 0,
    };

    mockedBatchProgress.mockResolvedValue(
      new Map([
        ['milestone-1', emptyProgress],
        [
          'milestone-2',
          {
            ...emptyProgress,
            totalIssues: 2,
            closedIssues: 1,
            totalItems: 2,
            completedItems: 1,
            openItems: 1,
            percentage: 50,
          },
        ],
      ]),
    );

    const result = await listMilestones('owner', 'demo', { page: 1, limit: 20 });

    expect(result.milestones).toHaveLength(2);
    expect(result.milestones[0]?.progress.percentage).toBe(0);
    expect(result.milestones[1]?.progress.percentage).toBe(50);

    expect(mockedBatchProgress).toHaveBeenCalledExactlyOnceWith('repo-1', [
      'milestone-1',
      'milestone-2',
    ]);

    expect(result.pagination.total).toBe(2);
  });
  it('gets a milestone scoped to its repository', async () => {
    const result = await getMilestone('owner', 'demo', 'milestone-1', 'user-1');

    expect(result).toEqual({
      ...milestone,
      progress: {
        totalIssues: 0,
        closedIssues: 0,
        totalPullRequests: 0,
        completedPullRequests: 0,
        totalItems: 0,
        completedItems: 0,
        openItems: 0,
        percentage: 0,
      },
    });

    expect(mockedProgress).toHaveBeenCalledWith('repo-1', 'milestone-1');

    expect(findRecord).toHaveBeenCalledWith({
      where: {
        id: 'milestone-1',
        repositoryId: 'repo-1',
      },
    });
  });

  it('rejects a milestone from another repository', async () => {
    findRecord.mockResolvedValue(null);

    await expect(getMilestone('owner', 'demo', 'foreign-milestone')).rejects.toMatchObject({
      statusCode: 404,
      code: 'MILESTONE_NOT_FOUND',
    });
  });

  it('updates milestone fields with WRITE permission', async () => {
    await updateMilestone('user-1', 'owner', 'demo', 'milestone-1', {
      title: 'Version 1.1',
      description: null,
      dueDate: null,
    });

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');

    expect(updateRecord).toHaveBeenCalledWith({
      where: {
        id: 'milestone-1',
        repositoryId: 'repo-1',
      },
      data: {
        title: 'Version 1.1',
        description: null,
        dueDate: null,
      },
    });
  });

  it('sets closedAt when closing an OPEN milestone', async () => {
    await updateMilestone('user-1', 'owner', 'demo', 'milestone-1', { state: 'CLOSED' });

    expect(updateRecord).toHaveBeenCalledWith({
      where: {
        id: 'milestone-1',
        repositoryId: 'repo-1',
      },
      data: {
        state: 'CLOSED',
        closedAt: expect.any(Date),
      },
    });
  });

  it('clears closedAt when reopening a CLOSED milestone', async () => {
    findRecord.mockResolvedValue({
      ...milestone,
      state: 'CLOSED',
      closedAt: new Date('2026-10-08T12:00:00Z'),
    });

    await updateMilestone('user-1', 'owner', 'demo', 'milestone-1', { state: 'OPEN' });

    expect(updateRecord).toHaveBeenCalledWith({
      where: {
        id: 'milestone-1',
        repositoryId: 'repo-1',
      },
      data: {
        state: 'OPEN',
        closedAt: null,
      },
    });
  });

  it('preserves closedAt when state is unchanged', async () => {
    await updateMilestone('user-1', 'owner', 'demo', 'milestone-1', { state: 'OPEN' });

    expect(updateRecord).toHaveBeenCalledWith({
      where: {
        id: 'milestone-1',
        repositoryId: 'repo-1',
      },
      data: {
        state: 'OPEN',
      },
    });
  });

  it('rejects duplicate title rename with 409', async () => {
    updateRecord.mockRejectedValue(duplicateError());

    await expect(
      updateMilestone('user-1', 'owner', 'demo', 'milestone-1', { title: 'Existing title' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'MILESTONE_ALREADY_EXISTS',
    });
  });

  it('detaches issues and pull requests before deleting a milestone', async () => {
    const issueUpdate = vi.mocked(prisma.issue.updateMany);
    const prUpdate = vi.mocked(prisma.pullRequest.updateMany);

    issueUpdate.mockResolvedValue({ count: 2 });
    prUpdate.mockResolvedValue({ count: 1 });

    await deleteMilestone('user-1', 'owner', 'demo', 'milestone-1');

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');

    expect(issueUpdate).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repo-1',
        milestoneId: 'milestone-1',
      },
      data: { milestoneId: null },
    });

    expect(prUpdate).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repo-1',
        milestoneId: 'milestone-1',
      },
      data: { milestoneId: null },
    });

    expect(deleteRecord).toHaveBeenCalledWith({
      where: {
        id: 'milestone-1',
        repositoryId: 'repo-1',
      },
    });

    expect(transaction).toHaveBeenCalledTimes(1);

    expect(issueUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      prUpdate.mock.invocationCallOrder[0]!,
    );

    expect(prUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      deleteRecord.mock.invocationCallOrder[0]!,
    );
  });

  it('does not delete when detaching issues fails', async () => {
    vi.mocked(prisma.issue.updateMany).mockRejectedValue(new Error('Issue update failed'));

    await expect(deleteMilestone('user-1', 'owner', 'demo', 'milestone-1')).rejects.toThrow(
      'Issue update failed',
    );

    expect(prisma.pullRequest.updateMany).not.toHaveBeenCalled();
    expect(deleteRecord).not.toHaveBeenCalled();
  });

  it('does not delete when detaching pull requests fails', async () => {
    vi.mocked(prisma.issue.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.pullRequest.updateMany).mockRejectedValue(
      new Error('Pull request update failed'),
    );

    await expect(deleteMilestone('user-1', 'owner', 'demo', 'milestone-1')).rejects.toThrow(
      'Pull request update failed',
    );

    expect(deleteRecord).not.toHaveBeenCalled();
  });
  it('does not delete a foreign repository milestone', async () => {
    findRecord.mockResolvedValue(null);

    await expect(
      deleteMilestone('user-1', 'owner', 'demo', 'foreign-milestone'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'MILESTONE_NOT_FOUND',
    });

    expect(deleteRecord).not.toHaveBeenCalled();
  });
});
