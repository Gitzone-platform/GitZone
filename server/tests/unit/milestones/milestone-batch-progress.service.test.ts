import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { calculateMilestonesProgress } from '../../../src/services/milestones/milestone-batch-progress.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    issue: { groupBy: vi.fn() },
    pullRequest: { groupBy: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const issueGroupBy = vi.mocked(prisma.issue.groupBy);
const pullRequestGroupBy = vi.mocked(prisma.pullRequest.groupBy);
const transaction = vi.mocked(prisma.$transaction);

const group = (milestoneId: string | null, state: string, count: unknown) => ({
  milestoneId,
  state,
  _count: { _all: count },
});

describe('Milestone batch progress service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    issueGroupBy.mockResolvedValue([] as never);
    pullRequestGroupBy.mockResolvedValue([] as never);

    transaction.mockImplementation(
      async (operations: unknown) => Promise.all(operations as Promise<unknown>[]) as never,
    );
  });

  it('does not query database for an empty milestone list', async () => {
    const result = await calculateMilestonesProgress('repo-1', []);

    expect(result.size).toBe(0);
    expect(issueGroupBy).not.toHaveBeenCalled();
    expect(pullRequestGroupBy).not.toHaveBeenCalled();
  });

  it('returns zero progress for milestones without items', async () => {
    const result = await calculateMilestonesProgress('repo-1', ['m1']);

    expect(result.get('m1')).toEqual({
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

  it('calculates mixed issue and pull request progress', async () => {
    issueGroupBy.mockResolvedValue([group('m1', 'OPEN', 3), group('m1', 'CLOSED', 2)] as never);

    pullRequestGroupBy.mockResolvedValue([
      group('m1', 'OPEN', 1),
      group('m1', 'CLOSED', 1),
      group('m1', 'MERGED', 3),
    ] as never);

    const result = await calculateMilestonesProgress('repo-1', ['m1']);

    expect(result.get('m1')).toEqual({
      totalIssues: 5,
      closedIssues: 2,
      totalPullRequests: 5,
      completedPullRequests: 4,
      totalItems: 10,
      completedItems: 6,
      openItems: 4,
      percentage: 60,
    });
  });

  it('calculates separate progress for multiple milestones', async () => {
    issueGroupBy.mockResolvedValue([group('m1', 'CLOSED', 2), group('m2', 'OPEN', 3)] as never);

    const result = await calculateMilestonesProgress('repo-1', ['m1', 'm2']);

    expect(result.get('m1')?.percentage).toBe(100);
    expect(result.get('m2')?.percentage).toBe(0);
    expect(result.size).toBe(2);
  });

  it('deduplicates milestone IDs', async () => {
    const result = await calculateMilestonesProgress('repo-1', ['m1', 'm1', 'm2']);

    expect(result.size).toBe(2);

    expect(issueGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId: 'repo-1',
          milestoneId: { in: ['m1', 'm2'] },
        },
      }),
    );
  });

  it('scopes both database queries to the repository', async () => {
    await calculateMilestonesProgress('repo-secure', ['m1']);

    for (const mock of [issueGroupBy, pullRequestGroupBy]) {
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            repositoryId: 'repo-secure',
            milestoneId: { in: ['m1'] },
          },
        }),
      );
    }
  });

  it('ignores groups for unrequested milestones', async () => {
    issueGroupBy.mockResolvedValue([
      group('m1', 'CLOSED', 1),
      group('foreign', 'CLOSED', 100),
      group(null, 'CLOSED', 100),
    ] as never);

    const result = await calculateMilestonesProgress('repo-1', ['m1']);

    expect(result.size).toBe(1);
    expect(result.get('m1')?.totalItems).toBe(1);
    expect(result.has('foreign')).toBe(false);
  });

  it('rejects missing count data', async () => {
    issueGroupBy.mockResolvedValue([{ milestoneId: 'm1', state: 'CLOSED' }] as never);

    await expect(calculateMilestonesProgress('repo-1', ['m1'])).rejects.toThrow(
      'Invalid Prisma groupBy count result',
    );
  });

  it.each([NaN, Infinity, -1, 1.5, '5', null])('rejects invalid count value %s', async (count) => {
    issueGroupBy.mockResolvedValue([group('m1', 'CLOSED', count)] as never);

    await expect(calculateMilestonesProgress('repo-1', ['m1'])).rejects.toThrow(
      'Invalid Prisma groupBy count value',
    );
  });

  it('uses two grouped queries regardless of milestone count', async () => {
    await calculateMilestonesProgress('repo-1', ['m1', 'm2', 'm3', 'm4']);

    expect(issueGroupBy).toHaveBeenCalledTimes(1);
    expect(pullRequestGroupBy).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
