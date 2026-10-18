import { getPublicUserProfile } from './profile.service.js';
import { getContributionAggregates } from './profile-contributions-aggregation.service.js';

import type {
  ContributionDay,
  ProfileContributionsResponse,
} from '../../types/profile-contributions.types.js';

const CONTRIBUTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const toDateKey = (date: Date): string => date.toISOString().slice(0, 10);

const getUtcDayStart = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const calculateStreaks = (
  days: ContributionDay[],
): { longestStreak: number; currentStreak: number } => {
  let longestStreak = 0;
  let runningStreak = 0;

  for (const day of days) {
    if (day.count > 0) {
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 0;
    }
  }

  // Today's contribution streak is still in progress.
  let currentStreak = 0;
  let index = days.length - 1;

  if (index >= 0 && days[index]?.count === 0) {
    index -= 1;
  }

  while (index >= 0 && (days[index]?.count ?? 0) > 0) {
    currentStreak += 1;
    index -= 1;
  }

  return {
    longestStreak,
    currentStreak,
  };
};

const toSafeCount = (value: bigint): number => {
  const count = Number(value);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid contribution aggregate count');
  }

  return count;
};

export const getUserPublicContributions = async (
  username: string,
  now: Date = new Date(),
): Promise<ProfileContributionsResponse> => {
  const user = await getPublicUserProfile(username);

  const today = getUtcDayStart(now);

  const start = new Date(today.getTime() - (CONTRIBUTION_DAYS - 1) * DAY_MS);

  const endExclusive = new Date(today.getTime() + DAY_MS);

  const aggregates = await getContributionAggregates(user.id, start, endExclusive);

  const counts = new Map<string, number>();

  for (let offset = 0; offset < CONTRIBUTION_DAYS; offset += 1) {
    const date = new Date(start.getTime() + offset * DAY_MS);
    counts.set(toDateKey(date), 0);
  }

  let repositories = 0;
  let issues = 0;
  let pullRequests = 0;

  for (const row of aggregates) {
    const key = toDateKey(row.date);

    if (!counts.has(key)) {
      continue;
    }

    const repositoryCount = toSafeCount(row.repositories);
    const issueCount = toSafeCount(row.issues);
    const pullRequestCount = toSafeCount(row.pullRequests);

    const dayTotal = repositoryCount + issueCount + pullRequestCount;

    const nextDayCount = (counts.get(key) ?? 0) + dayTotal;

    if (!Number.isSafeInteger(nextDayCount)) {
      throw new Error('Contribution daily total exceeds safe integer range');
    }

    counts.set(key, nextDayCount);

    repositories += repositoryCount;
    issues += issueCount;
    pullRequests += pullRequestCount;
  }

  const days: ContributionDay[] = Array.from(counts, ([date, count]) => ({ date, count }));

  const total = days.reduce((sum, day) => sum + day.count, 0);

  const activeDays = days.filter((day) => day.count > 0).length;

  const streaks = calculateStreaks(days);

  return {
    from: toDateKey(start),
    to: toDateKey(today),
    total,
    activeDays,
    ...streaks,
    breakdown: {
      repositories,
      issues,
      pullRequests,
    },
    days,
  };
};
