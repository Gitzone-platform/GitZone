import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import { starRepository } from '../../../src/services/repositories/repository-star.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: vi.fn(),
    },
    repositoryStar: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const mockedFindFirst = vi.mocked(prisma.repository.findFirst);
const mockedUpsert = vi.mocked(prisma.repositoryStar.upsert);
const mockedAuthorize = vi.mocked(authorizeRepositoryAccess);

describe('starRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 404 when repository does not exist', async () => {
    mockedFindFirst.mockResolvedValue(null);

    await expect(starRepository('user-1', 'asil', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(mockedAuthorize).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it('stars an accessible repository', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'PUBLIC' } as never);
    mockedUpsert.mockResolvedValue({ id: 'star-1' } as never);

    const result = await starRepository('user-1', 'asil', 'demo');

    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: {
        name: 'demo',
        owner: {
          username: 'asil',
        },
      },
      select: {
        id: true,
      },
    });

    expect(mockedAuthorize).toHaveBeenCalledWith('repo-1', 'READ', 'user-1');

    expect(mockedUpsert).toHaveBeenCalledWith({
      where: {
        userId_repositoryId: {
          userId: 'user-1',
          repositoryId: 'repo-1',
        },
      },
      create: {
        userId: 'user-1',
        repositoryId: 'repo-1',
      },
      update: {},
    });

    expect(result).toEqual({
      repositoryId: 'repo-1',
      starred: true,
    });
  });

  it('allows an authorized private repository collaborator', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'private-repo' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'READ' } as never);
    mockedUpsert.mockResolvedValue({ id: 'star-2' } as never);

    await expect(starRepository('collaborator-1', 'asil', 'private')).resolves.toEqual({
      repositoryId: 'private-repo',
      starred: true,
    });

    expect(mockedAuthorize).toHaveBeenCalledWith('private-repo', 'READ', 'collaborator-1');
  });

  it('denies star when repository read access is forbidden', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'private-repo' } as never);

    mockedAuthorize.mockRejectedValue({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    await expect(starRepository('stranger-1', 'asil', 'private')).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it('uses an idempotent upsert for repeated star requests', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'PUBLIC' } as never);
    mockedUpsert.mockResolvedValue({ id: 'star-1' } as never);

    const first = await starRepository('user-1', 'asil', 'demo');
    const second = await starRepository('user-1', 'asil', 'demo');

    expect(first).toEqual(second);
    expect(mockedUpsert).toHaveBeenCalledTimes(2);

    for (const call of mockedUpsert.mock.calls) {
      expect(call[0]).toMatchObject({
        where: {
          userId_repositoryId: {
            userId: 'user-1',
            repositoryId: 'repo-1',
          },
        },
        update: {},
      });
    }
  });

  it('propagates database errors', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'PUBLIC' } as never);
    mockedUpsert.mockRejectedValue(new Error('Database unavailable'));

    await expect(starRepository('user-1', 'asil', 'demo')).rejects.toThrow('Database unavailable');
  });
});
