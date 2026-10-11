import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import { getRepositoryStarCount } from '../../../src/services/repositories/repository-star.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: vi.fn(),
    },
    repositoryStar: {
      count: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const mockedFindFirst = vi.mocked(prisma.repository.findFirst);
const mockedCount = vi.mocked(prisma.repositoryStar.count);
const mockedAuthorize = vi.mocked(authorizeRepositoryAccess);

describe('getRepositoryStarCount', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 404 when repository does not exist', async () => {
    mockedFindFirst.mockResolvedValue(null);

    await expect(
      getRepositoryStarCount('asil', 'missing'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(mockedAuthorize).not.toHaveBeenCalled();
    expect(mockedCount).not.toHaveBeenCalled();
  });

  it('returns zero stars for a public repository', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'PUBLIC' } as never);
    mockedCount.mockResolvedValue(0);

    const result = await getRepositoryStarCount('asil', 'demo');

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
      undefined,
    );

    expect(mockedCount).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repo-1',
      },
    });

    expect(result).toEqual({
      repositoryId: 'repo-1',
      starCount: 0,
    });
  });

  it('returns the correct count for multiple stars', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'PUBLIC' } as never);
    mockedCount.mockResolvedValue(12);

    await expect(
      getRepositoryStarCount('asil', 'demo'),
    ).resolves.toEqual({
      repositoryId: 'repo-1',
      starCount: 12,
    });
  });

  it('allows an authorized private repository collaborator', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'private-repo' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'READ' } as never);
    mockedCount.mockResolvedValue(3);

    await expect(
      getRepositoryStarCount('asil', 'private', 'collaborator-1'),
    ).resolves.toEqual({
      repositoryId: 'private-repo',
      starCount: 3,
    });

    expect(mockedAuthorize).toHaveBeenCalledWith(
      'private-repo',
      'READ',
      'collaborator-1',
    );
  });

  it('denies unauthorized access without querying star count', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'private-repo' } as never);
    mockedAuthorize.mockRejectedValue({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    await expect(
      getRepositoryStarCount('asil', 'private', 'stranger-1'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    expect(mockedCount).not.toHaveBeenCalled();
  });

  it('propagates database count errors', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);
    mockedAuthorize.mockResolvedValue({ permission: 'PUBLIC' } as never);
    mockedCount.mockRejectedValue(new Error('Database unavailable'));

    await expect(
      getRepositoryStarCount('asil', 'demo'),
    ).rejects.toThrow('Database unavailable');
  });

  it('waits for authorization before counting stars', async () => {
    mockedFindFirst.mockResolvedValue({ id: 'repo-1' } as never);

    let allowAuthorization: (() => void) | undefined;

    mockedAuthorize.mockImplementation(
      () =>
        new Promise((resolve) => {
          allowAuthorization = () => {
            resolve({ permission: 'PUBLIC' } as never);
          };
        }),
    );

    mockedCount.mockResolvedValue(5);

    const resultPromise = getRepositoryStarCount('asil', 'demo');

    await vi.waitFor(() => {
      expect(mockedAuthorize).toHaveBeenCalledTimes(1);
    });

    expect(mockedCount).not.toHaveBeenCalled();

    if (!allowAuthorization) {
      throw new Error('Authorization callback missing');
    }

    allowAuthorization();

    await expect(resultPromise).resolves.toEqual({
      repositoryId: 'repo-1',
      starCount: 5,
    });

    expect(mockedCount).toHaveBeenCalledTimes(1);
  });
});
