import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../src/errors/app.error.js';
import { getPublicUserProfile } from '../../../src/services/profiles/profile.service.js';
import { getContributionAggregates } from '../../../src/services/profiles/profile-contributions-aggregation.service.js';
import { getUserPublicContributions } from '../../../src/services/profiles/profile-contributions.service.js';

vi.mock('../../../src/services/profiles/profile.service.js', () => ({
  getPublicUserProfile: vi.fn(),
}));

vi.mock('../../../src/services/profiles/profile-contributions-aggregation.service.js', () => ({
  getContributionAggregates: vi.fn(),
}));

const mockedGetProfile = vi.mocked(getPublicUserProfile);
const mockedGetAggregates = vi.mocked(getContributionAggregates);

const NOW = new Date('2026-10-09T12:00:00.000Z');

const publicUser = {
  id: 'user-1',
  username: 'asil',
  name: 'Asil',
  bio: null,
  avatarUrl: null,
  location: null,
  website: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const row = (date: string, repositories = 0n, issues = 0n, pullRequests = 0n) => ({
  date: new Date(date),
  repositories,
  issues,
  pullRequests,
});

describe('getUserPublicContributions with aggregation', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedGetProfile.mockResolvedValue(publicUser);
    mockedGetAggregates.mockResolvedValue([]);
  });

  it('returns exactly 365 consecutive UTC days', async () => {
    const result = await getUserPublicContributions('asil', NOW);

    expect(result.days).toHaveLength(365);
    expect(result.from).toBe('2025-10-10');
    expect(result.to).toBe('2026-10-09');
    expect(result.days[0]?.date).toBe(result.from);
    expect(result.days[364]?.date).toBe(result.to);

    for (let index = 1; index < result.days.length; index += 1) {
      const previous = Date.parse(`${result.days[index - 1]?.date}T00:00:00.000Z`);
      const current = Date.parse(`${result.days[index]?.date}T00:00:00.000Z`);

      expect(current - previous).toBe(86400000);
    }
  });

  it('passes the correct user and date range to aggregation', async () => {
    await getUserPublicContributions('asil', NOW);

    expect(mockedGetProfile).toHaveBeenCalledWith('asil');

    expect(mockedGetAggregates).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      new Date('2025-10-10T00:00:00.000Z'),
      new Date('2026-10-10T00:00:00.000Z'),
    );
  });

  it('returns zero statistics for empty aggregates', async () => {
    const result = await getUserPublicContributions('asil', NOW);

    expect(result.total).toBe(0);
    expect(result.activeDays).toBe(0);
    expect(result.longestStreak).toBe(0);
    expect(result.currentStreak).toBe(0);

    expect(result.breakdown).toEqual({
      repositories: 0,
      issues: 0,
      pullRequests: 0,
    });

    expect(result.days.every((day) => day.count === 0)).toBe(true);
  });

  it('combines aggregated repository, issue and pull request counts', async () => {
    mockedGetAggregates.mockResolvedValue([
      row('2026-10-08T00:00:00.000Z', 1n, 1n, 0n),
      row('2026-10-09T00:00:00.000Z', 0n, 1n, 1n),
    ]);

    const result = await getUserPublicContributions('asil', NOW);

    expect(result.total).toBe(4);
    expect(result.activeDays).toBe(2);

    expect(result.breakdown).toEqual({
      repositories: 1,
      issues: 2,
      pullRequests: 1,
    });

    expect(result.days.find((day) => day.date === '2026-10-08')?.count).toBe(2);

    expect(result.days.find((day) => day.date === '2026-10-09')?.count).toBe(2);
  });

  it('calculates the longest consecutive contribution streak', async () => {
    mockedGetAggregates.mockResolvedValue([
      row('2026-10-01T00:00:00.000Z', 1n),
      row('2026-10-02T00:00:00.000Z', 1n),
      row('2026-10-03T00:00:00.000Z', 1n),
      row('2026-10-05T00:00:00.000Z', 1n),
      row('2026-10-06T00:00:00.000Z', 1n),
    ]);

    const result = await getUserPublicContributions('asil', NOW);

    expect(result.longestStreak).toBe(3);
    expect(result.currentStreak).toBe(0);
  });

  it('counts a current streak ending today', async () => {
    mockedGetAggregates.mockResolvedValue([
      row('2026-10-07T00:00:00.000Z', 0n, 1n),
      row('2026-10-08T00:00:00.000Z', 0n, 1n),
      row('2026-10-09T00:00:00.000Z', 0n, 1n),
    ]);

    const result = await getUserPublicContributions('asil', NOW);

    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
  });

  it('preserves a current streak ending yesterday', async () => {
    mockedGetAggregates.mockResolvedValue([
      row('2026-10-07T00:00:00.000Z', 0n, 1n),
      row('2026-10-08T00:00:00.000Z', 0n, 1n),
    ]);

    const result = await getUserPublicContributions('asil', NOW);

    expect(result.currentStreak).toBe(2);
    expect(result.longestStreak).toBe(2);
  });

  it('ignores aggregate rows outside the 365-day window', async () => {
    mockedGetAggregates.mockResolvedValue([
      row('2025-10-09T00:00:00.000Z', 10n),
      row('2026-10-10T00:00:00.000Z', 10n),
      row('2026-10-09T00:00:00.000Z', 1n),
    ]);

    const result = await getUserPublicContributions('asil', NOW);

    expect(result.total).toBe(1);
    expect(result.breakdown.repositories).toBe(1);
  });

  it('rejects negative aggregate counts', async () => {
    mockedGetAggregates.mockResolvedValue([row('2026-10-09T00:00:00.000Z', -1n)]);

    await expect(getUserPublicContributions('asil', NOW)).rejects.toThrow(
      'Invalid contribution aggregate count',
    );
  });

  it('rejects aggregate counts outside the safe integer range', async () => {
    mockedGetAggregates.mockResolvedValue([row('2026-10-09T00:00:00.000Z', 9007199254740992n)]);

    await expect(getUserPublicContributions('asil', NOW)).rejects.toThrow(
      'Invalid contribution aggregate count',
    );
  });

  it('rejects daily totals outside the safe integer range', async () => {
    mockedGetAggregates.mockResolvedValue([row('2026-10-09T00:00:00.000Z', 9007199254740991n, 1n)]);

    await expect(getUserPublicContributions('asil', NOW)).rejects.toThrow(
      'Contribution daily total exceeds safe integer range',
    );
  });

  it('does not query aggregates for a nonexistent user', async () => {
    mockedGetProfile.mockRejectedValue(new AppError('User not found', 404, 'USER_NOT_FOUND'));

    await expect(getUserPublicContributions('missinguser', NOW)).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(mockedGetAggregates).not.toHaveBeenCalled();
  });

  it('propagates aggregation database errors', async () => {
    mockedGetAggregates.mockRejectedValue(new Error('Database unavailable'));

    await expect(getUserPublicContributions('asil', NOW)).rejects.toThrow('Database unavailable');
  });
});
