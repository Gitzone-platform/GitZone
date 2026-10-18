import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getContributionAggregates } from '../../../src/services/profiles/profile-contributions-aggregation.service.js';

const prismaMocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    $queryRaw: prismaMocks.queryRaw,
  },
}));

const USER_ID = 'user-1';
const START = new Date('2025-10-10T00:00:00.000Z');
const END = new Date('2026-10-10T00:00:00.000Z');

describe('getContributionAggregates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMocks.queryRaw.mockResolvedValue([]);
  });

  it('executes exactly one parameterized database query', async () => {
    await getContributionAggregates(USER_ID, START, END);

    expect(prismaMocks.queryRaw).toHaveBeenCalledOnce();

    const [strings, ...values] = prismaMocks.queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];

    expect(Array.from(strings).join(' ')).toContain('WITH contributions AS');
    expect(values).toContain(USER_ID);
    expect(values).toContain(START);
    expect(values).toContain(END);
  });

  it('filters repository, issue and pull request contributions', async () => {
    await getContributionAggregates(USER_ID, START, END);

    const [strings] = prismaMocks.queryRaw.mock.calls[0] as [TemplateStringsArray];

    const sql = Array.from(strings).join(' ');

    expect(sql).toContain('FROM "Repository" r');
    expect(sql).toContain('FROM "Issue" i');
    expect(sql).toContain('FROM "PullRequest" p');

    expect(sql.match(/r\."isPrivate"\s*=\s*false/g)).toHaveLength(3);

    expect(sql).toContain('i."creatorId"');
    expect(sql).toContain('p."authorId"');
    expect(sql).toContain('r."ownerId"');
  });

  it('groups contributions by UTC calendar day', async () => {
    await getContributionAggregates(USER_ID, START, END);

    const [strings] = prismaMocks.queryRaw.mock.calls[0] as [TemplateStringsArray];

    const sql = Array.from(strings).join(' ');

    expect(sql.match(/AT TIME ZONE 'UTC'/g)).toHaveLength(3);

    expect(sql).toContain('GROUP BY day');
    expect(sql).toContain('ORDER BY day ASC');
  });

  it('returns aggregated bigint counts without modification', async () => {
    const rows = [
      {
        date: new Date('2026-10-08T00:00:00.000Z'),
        repositories: 2n,
        issues: 3n,
        pullRequests: 1n,
      },
      {
        date: new Date('2026-10-09T00:00:00.000Z'),
        repositories: 0n,
        issues: 1n,
        pullRequests: 2n,
      },
    ];

    prismaMocks.queryRaw.mockResolvedValue(rows);

    const result = await getContributionAggregates(USER_ID, START, END);

    expect(result).toEqual(rows);
    expect(result[0]?.repositories).toBe(2n);
    expect(result[1]?.pullRequests).toBe(2n);
  });

  it('returns an empty array when there are no contributions', async () => {
    const result = await getContributionAggregates(USER_ID, START, END);

    expect(result).toEqual([]);
  });

  it('propagates database errors', async () => {
    prismaMocks.queryRaw.mockRejectedValue(new Error('Aggregation query failed'));

    await expect(getContributionAggregates(USER_ID, START, END)).rejects.toThrow(
      'Aggregation query failed',
    );
  });
});
