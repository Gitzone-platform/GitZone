import prisma from '../../config/prisma.js';

export type MilestoneProgress = {
  totalIssues: number;
  closedIssues: number;
  totalPullRequests: number;
  completedPullRequests: number;
  totalItems: number;
  completedItems: number;
  openItems: number;
  percentage: number;
};

export const calculateMilestoneProgress = async (
  repositoryId: string,
  milestoneId: string,
): Promise<MilestoneProgress> => {
  const issueWhere = {
    repositoryId,
    milestoneId,
  };

  const pullRequestWhere = {
    repositoryId,
    milestoneId,
  };

  const [totalIssues, closedIssues, totalPullRequests, completedPullRequests] =
    await prisma.$transaction([
      prisma.issue.count({
        where: issueWhere,
      }),
      prisma.issue.count({
        where: {
          ...issueWhere,
          state: 'CLOSED',
        },
      }),
      prisma.pullRequest.count({
        where: pullRequestWhere,
      }),
      prisma.pullRequest.count({
        where: {
          ...pullRequestWhere,
          state: {
            in: ['CLOSED', 'MERGED'],
          },
        },
      }),
    ]);

  const totalItems = totalIssues + totalPullRequests;
  const completedItems = closedIssues + completedPullRequests;
  const openItems = totalItems - completedItems;

  const percentage = totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 10000) / 100;

  return {
    totalIssues,
    closedIssues,
    totalPullRequests,
    completedPullRequests,
    totalItems,
    completedItems,
    openItems,
    percentage,
  };
};
