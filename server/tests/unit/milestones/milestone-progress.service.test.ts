import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { calculateMilestoneProgress } from '../../../src/services/milestones/milestone-progress.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    issue: { count: vi.fn() },
    pullRequest: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const issueCount = vi.mocked(prisma.issue.count);
const pullRequestCount = vi.mocked(prisma.pullRequest.count);
const transaction = vi.mocked(prisma.$transaction);

const repositoryId = 'repo-1';
const milestoneId = 'milestone-1';

const setCounts = (
  totalIssues: number,
  closedIssues: number,
  totalPullRequests: number,
  completedPullRequests: number,
) => {
  issueCount.mockResolvedValueOnce(totalIssues).mockResolvedValueOnce(closedIssues);

  pullRequestCount
    .mockResolvedValueOnce(totalPullRequests)
    .mockResolvedValueOnce(completedPullRequests);
};

describe('Milestone progress service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    transaction.mockImplementation((async (operations: Promise<unknown>[]) =>
      Promise.all(operations)) as never);
  });

  it('returns zero progress for an empty milestone', async () => {
    setCounts(0, 0, 0, 0);

    const result = await calculateMilestoneProgress(repositoryId, milestoneId);

    expect(result).toEqual({
      totalIssues: 0,
      closedIssues: 0,
      totalPullRequests: 0,
      completedPullRequests: 0,
      totalItems: 0,
      completedItems: 0,
      openItems: 0,
      percentage: 0,
    });
  });

  it('returns zero percent when all items are open', async () => {
    setCounts(3, 0, 2, 0);

    const result = await calculateMilestoneProgress(repositoryId, milestoneId);

    expect(result.totalItems).toBe(5);
    expect(result.openItems).toBe(5);
    expect(result.percentage).toBe(0);
  });

  it('returns 100 percent when all items are completed', async () => {
    setCounts(3, 3, 2, 2);

    const result = await calculateMilestoneProgress(repositoryId, milestoneId);

    expect(result.completedItems).toBe(5);
    expect(result.openItems).toBe(0);
    expect(result.percentage).toBe(100);
  });

  it('calculates mixed issue and pull request progress', async () => {
    setCounts(4, 2, 2, 1);

    const result = await calculateMilestoneProgress(repositoryId, milestoneId);

    expect(result).toMatchObject({
      totalIssues: 4,
      closedIssues: 2,
      totalPullRequests: 2,
      completedPullRequests: 1,
      totalItems: 6,
      completedItems: 3,
      openItems: 3,
      percentage: 50,
    });
  });

  it('rounds percentage to two decimal places', async () => {
    setCounts(3, 1, 0, 0);

    const result = await calculateMilestoneProgress(repositoryId, milestoneId);

    expect(result.percentage).toBe(33.33);
  });

  it('calculates progress with issues only', async () => {
    setCounts(5, 4, 0, 0);

    const result = await calculateMilestoneProgress(repositoryId, milestoneId);

    expect(result.percentage).toBe(80);
    expect(result.completedItems).toBe(4);
  });

  it('calculates progress with pull requests only', async () => {
    setCounts(0, 0, 4, 3);

    const result = await calculateMilestoneProgress(repositoryId, milestoneId);

    expect(result.percentage).toBe(75);
    expect(result.openItems).toBe(1);
  });

  it('scopes every count query to repository and milestone', async () => {
    setCounts(2, 1, 2, 1);

    await calculateMilestoneProgress(repositoryId, milestoneId);

    expect(issueCount).toHaveBeenNthCalledWith(1, {
      where: { repositoryId, milestoneId },
    });

    expect(issueCount).toHaveBeenNthCalledWith(2, {
      where: {
        repositoryId,
        milestoneId,
        state: 'CLOSED',
      },
    });

    expect(pullRequestCount).toHaveBeenNthCalledWith(1, {
      where: { repositoryId, milestoneId },
    });

    expect(pullRequestCount).toHaveBeenNthCalledWith(2, {
      where: {
        repositoryId,
        milestoneId,
        state: { in: ['CLOSED', 'MERGED'] },
      },
    });
  });

  it('executes the four counts in a transaction', async () => {
    setCounts(1, 1, 1, 0);

    await calculateMilestoneProgress(repositoryId, milestoneId);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ]),
    );
  });
});
