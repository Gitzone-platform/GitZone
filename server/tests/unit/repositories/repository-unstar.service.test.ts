import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import { unstarRepository } from '../../../src/services/repositories/repository-star.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: vi.fn(),
    },
    repositoryStar: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const mockedFindFirst = vi.mocked(prisma.repository.findFirst);
const mockedDeleteMany = vi.mocked(prisma.repositoryStar.deleteMany);
const mockedAuthorize = vi.mocked(authorizeRepositoryAccess);

describe('unstarRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 404 when repository does not exist', async () => {
    mockedFindFirst.mockResolvedValue(null);

    await expect(
      unstarRepository('user-1', 'asil', 'missing'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(mockedAuthorize).not.toHaveBeenCalled();
    expect(mockedDeleteMany).not.toHaveBeenCalled();
  });

  it('removes a star from an accessible repository', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'PUBLIC' } as never);
    mockedDeleteMany.mockResolvedValue({ count: 1 });

    const result = await unstarRepository('user-1', 'asil', 'demo');

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

    expect(mockedAuthorize).toHaveBeenCalledWith(
      'repo-1',
      'READ',
      'user-1',
    );

    expect(mockedDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        repositoryId: 'repo-1',
      },
    });

    expect(result).toEqual({
      repositoryId: 'repo-1',
      starred: false,
    });
  });

  it('allows an authorized private repository collaborator', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'private-repo' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'READ' } as never);
    mockedDeleteMany.mockResolvedValue({ count: 1 });

    await expect(
      unstarRepository('collaborator-1', 'asil', 'private'),
    ).resolves.toEqual({
      repositoryId: 'private-repo',
      starred: false,
    });

    expect(mockedAuthorize).toHaveBeenCalledWith(
      'private-repo',
      'READ',
      'collaborator-1',
    );
  });

  it('denies unstar when repository read access is forbidden', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'private-repo' } as never);

    mockedAuthorize.mockRejectedValue({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    await expect(
      unstarRepository('stranger-1', 'asil', 'private'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    expect(mockedDeleteMany).not.toHaveBeenCalled();
  });

  it('is idempotent when the repository is already unstarred', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'PUBLIC' } as never);
    mockedDeleteMany.mockResolvedValue({ count: 0 });

    const first = await unstarRepository('user-1', 'asil', 'demo');
    const second = await unstarRepository('user-1', 'asil', 'demo');

    expect(first).toEqual({
      repositoryId: 'repo-1',
      starred: false,
    });

    expect(second).toEqual(first);
    expect(mockedDeleteMany).toHaveBeenCalledTimes(2);
  });

  it('propagates database errors', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'PUBLIC' } as never);
    mockedDeleteMany.mockRejectedValue(new Error('Database unavailable'));

    await expect(
      unstarRepository('user-1', 'asil', 'demo'),
    ).rejects.toThrow('Database unavailable');
  });
});
