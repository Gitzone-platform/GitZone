import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  authorizeRepositoryAccess: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: mocks.findFirst,
    },
    repositoryWatch: {
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock(
  '../../../src/services/repositories/repository-authorization.service.js',
  () => ({
    authorizeRepositoryAccess: mocks.authorizeRepositoryAccess,
  }),
);

import { updateRepositoryWatchPreference } from '../../../src/services/repositories/repository-watch.service.js';

describe('updateRepositoryWatchPreference', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.findFirst.mockResolvedValue({ id: 'repository-1' });
    mocks.authorizeRepositoryAccess.mockResolvedValue(undefined);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each(['ALL', 'PARTICIPATING', 'IGNORE'] as const)(
    'updates preference to %s',
    async (preference) => {
      await expect(
        updateRepositoryWatchPreference(
          'user-1',
          'owner',
          'project',
          preference,
        ),
      ).resolves.toEqual({
        repositoryId: 'repository-1',
        watching: true,
        preference,
      });

      expect(mocks.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          repositoryId: 'repository-1',
        },
        data: { preference },
      });
    },
  );

  it('looks up repository by owner and name', async () => {
    await updateRepositoryWatchPreference(
      'user-1',
      'owner',
      'project',
      'ALL',
    );

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        name: 'project',
        owner: { username: 'owner' },
      },
      select: { id: true },
    });
  });

  it('rejects missing repositories before authorization or write', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(
      updateRepositoryWatchPreference(
        'user-1',
        'owner',
        'missing',
        'ALL',
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(mocks.authorizeRepositoryAccess).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('authorizes READ access for the current user', async () => {
    await updateRepositoryWatchPreference(
      'user-1',
      'owner',
      'project',
      'PARTICIPATING',
    );

    expect(mocks.authorizeRepositoryAccess).toHaveBeenCalledWith(
      'repository-1',
      'READ',
      'user-1',
    );
  });

  it('rejects unauthorized private repository access without writing', async () => {
    mocks.authorizeRepositoryAccess.mockRejectedValue(
      Object.assign(new Error('Access denied'), {
        statusCode: 403,
        code: 'REPOSITORY_ACCESS_DENIED',
      }),
    );

    await expect(
      updateRepositoryWatchPreference(
        'user-1',
        'owner',
        'private-project',
        'IGNORE',
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('returns WATCH_NOT_FOUND when no watch exists', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      updateRepositoryWatchPreference(
        'user-1',
        'owner',
        'project',
        'ALL',
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'WATCH_NOT_FOUND',
    });
  });

  it('propagates database update errors', async () => {
    const error = new Error('Database unavailable');
    mocks.updateMany.mockRejectedValue(error);

    await expect(
      updateRepositoryWatchPreference(
        'user-1',
        'owner',
        'project',
        'ALL',
      ),
    ).rejects.toBe(error);
  });

  it('performs authorization before attempting the update', async () => {
    const order: string[] = [];

    mocks.authorizeRepositoryAccess.mockImplementation(async () => {
      order.push('authorize');
    });

    mocks.updateMany.mockImplementation(async () => {
      order.push('update');
      return { count: 1 };
    });

    await updateRepositoryWatchPreference(
      'user-1',
      'owner',
      'project',
      'ALL',
    );

    expect(order).toEqual(['authorize', 'update']);
  });
});
