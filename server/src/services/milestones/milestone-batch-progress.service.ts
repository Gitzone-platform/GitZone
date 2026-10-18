import prisma from '../../config/prisma.js';

import type { MilestoneProgress } from './milestone-progress.service.js';

type ProgressCounts = {
  totalIssues: number;
  closedIssues: number;
  totalPullRequests: number;
  completedPullRequests: number;
};

const emptyCounts = (): ProgressCounts => ({
  totalIssues: 0,
  closedIssues: 0,
  totalPullRequests: 0,
  completedPullRequests: 0,
});

const readGroupCount = (value: unknown): number => {
  if (typeof value !== 'object' || value === null || !('_all' in value)) {
    throw new Error('Invalid Prisma groupBy count result');
  }

  const count = value._all;

  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid Prisma groupBy count value');
  }

  return count;
};
export const calculateMilestonesProgress = async (
  repositoryId: string,
  milestoneIds: string[],
): Promise<Map<string, MilestoneProgress>> => {
  const result = new Map<string, MilestoneProgress>();

  if (milestoneIds.length === 0) {
    return result;
  }

  const uniqueIds = [...new Set(milestoneIds)];

  const [issueGroups, pullRequestGroups] = await prisma.$transaction([
    prisma.issue.groupBy({
      by: ['milestoneId', 'state'] as const,
      orderBy: [{ milestoneId: 'asc' as const }, { state: 'asc' as const }],
      where: {
        repositoryId,
        milestoneId: { in: uniqueIds },
      },
      _count: { _all: true },
    }),
    prisma.pullRequest.groupBy({
      by: ['milestoneId', 'state'] as const,
      orderBy: [{ milestoneId: 'asc' as const }, { state: 'asc' as const }],
      where: {
        repositoryId,
        milestoneId: { in: uniqueIds },
      },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, ProgressCounts>();

  for (const id of uniqueIds) {
    counts.set(id, emptyCounts());
  }

  for (const group of issueGroups) {
    if (group.milestoneId === null) continue;

    const item = counts.get(group.milestoneId);
    if (!item) continue;

    const count = readGroupCount(group._count);

    item.totalIssues += count;

    if (group.state === 'CLOSED') {
      item.closedIssues += count;
    }
  }

  for (const group of pullRequestGroups) {
    if (group.milestoneId === null) continue;

    const item = counts.get(group.milestoneId);
    if (!item) continue;

    const count = readGroupCount(group._count);

    item.totalPullRequests += count;

    if (group.state === 'CLOSED' || group.state === 'MERGED') {
      item.completedPullRequests += count;
    }
  }

  for (const [id, item] of counts) {
    const totalItems = item.totalIssues + item.totalPullRequests;
    const completedItems = item.closedIssues + item.completedPullRequests;

    result.set(id, {
      ...item,
      totalItems,
      completedItems,
      openItems: totalItems - completedItems,
      percentage: totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 10000) / 100,
    });
  }

  return result;
};
