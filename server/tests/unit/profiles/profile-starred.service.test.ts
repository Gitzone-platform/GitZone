import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { getUserStarredRepositories } from '../../../src/services/profiles/profile-starred.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    repositoryStar: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockedUser = vi.mocked(prisma.user.findUnique);
const mockedFindMany = vi.mocked(prisma.repositoryStar.findMany);
const mockedCount = vi.mocked(prisma.repositoryStar.count);
const mockedTransaction = vi.mocked(prisma.$transaction);

const query = { page: 1, limit: 20 };

const repository = {
  id: 'repo-1',
  name: 'gitzone',
  description: 'Git hosting',
  isPrivate: false,
  defaultBranch: 'main',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
  owner: {
    id: 'owner-1',
    username: 'owner',
    name: 'Owner',
    avatarUrl: null,
  },
};

const starredAt = new Date('2026-10-10T12:00:00.000Z');

describe('getUserStarredRepositories', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedUser.mockResolvedValue({ id: 'user-1' } as never);

    mockedTransaction.mockImplementation(async (operations: unknown) => {
      if (!Array.isArray(operations)) {
        throw new Error('Expected array transaction');
      }

      return Promise.all(operations);
    });

    mockedFindMany.mockResolvedValue([]);
    mockedCount.mockResolvedValue(0);
  });

  it('returns paginated public starred repositories', async () => {
    mockedFindMany.mockResolvedValue([
      { createdAt: starredAt, repository },
    ] as never);
    mockedCount.mockResolvedValue(1);

    const result = await getUserStarredRepositories(
      'asil',
      undefined,
      query,
    );

    expect(result.repositories).toEqual([
      { ...repository, starredAt },
    ]);

    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });

    expect(mockedUser).toHaveBeenCalledWith({
      where: { username: 'asil' },
      select: { id: true },
    });
  });

  it('restricts anonymous viewers to public repositories', async () => {
    await getUserStarredRepositories('asil', undefined, query);

    const args = mockedFindMany.mock.calls[0]?.[0];

    expect(args?.where).toEqual({
      userId: 'user-1',
      repository: {
        is: {
          OR: [{ isPrivate: false }],
        },
      },
    });

    expect(mockedCount).toHaveBeenCalledWith({
      where: args?.where,
    });
  });

  it('allows private repositories owned by the viewer', async () => {
    await getUserStarredRepositories('asil', 'viewer-1', query);

    const args = mockedFindMany.mock.calls[0]?.[0];

    expect(args?.where).toEqual({
      userId: 'user-1',
      repository: {
        is: {
          OR: [
            { isPrivate: false },
            { ownerId: 'viewer-1' },
            {
              collaborators: {
                some: { userId: 'viewer-1' },
              },
            },
          ],
        },
      },
    });
  });

  it('applies pagination and stable newest-first ordering', async () => {
    await getUserStarredRepositories(
      'asil',
      undefined,
      { page: 3, limit: 5 },
    );

    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 5,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      }),
    );
  });

  it('calculates total pages using the filtered count', async () => {
    mockedCount.mockResolvedValue(21);

    const result = await getUserStarredRepositories(
      'asil',
      undefined,
      { page: 2, limit: 10 },
    );

    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
  });

  it('rejects a nonexistent profile before querying stars', async () => {
    mockedUser.mockResolvedValue(null);

    await expect(
      getUserStarredRepositories('missinguser', undefined, query),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(mockedFindMany).not.toHaveBeenCalled();
    expect(mockedCount).not.toHaveBeenCalled();
  });

  it('selects only approved repository and owner fields', async () => {
    await getUserStarredRepositories('asil', undefined, query);

    const args = mockedFindMany.mock.calls[0]?.[0];

    expect(args?.select).toEqual({
      createdAt: true,
      repository: {
        select: {
          id: true,
          name: true,
          description: true,
          isPrivate: true,
          defaultBranch: true,
          createdAt: true,
          updatedAt: true,
          owner: {
            select: {
              id: true,
              username: true,
              name: true,
              avatarUrl: true,
            },
          },
        },
      },
    });

    expect(args?.select).not.toHaveProperty('user');
  });
});
