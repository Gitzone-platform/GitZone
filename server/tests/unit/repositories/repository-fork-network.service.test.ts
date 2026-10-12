import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { getRepositoryForkNetwork } from '../../../src/services/repositories/repository-fork-network.service.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const findFirst = vi.mocked(prisma.repository.findFirst);
const findUnique = vi.mocked(prisma.repository.findUnique);
const findMany = vi.mocked(prisma.repository.findMany);
const count = vi.mocked(prisma.repository.count);
const authorize = vi.mocked(authorizeRepositoryAccess);

describe('repository fork network service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findFirst.mockResolvedValue({
      id: 'repo-1',
      name: 'project',
      ownerId: 'owner-1',
      isPrivate: false,
      forkedFromId: null,
    } as never);

    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    authorize.mockResolvedValue({} as never);
  });

  it('returns root repository metadata', async () => {
    const result = await getRepositoryForkNetwork('alice', 'project');

    expect(result).toMatchObject({
      repositoryId: 'repo-1',
      isFork: false,
      parent: null,
      forkCount: 0,
      totalForkCount: 0,
      hasMore: false,
    });
  });

  it('rejects missing repository', async () => {
    findFirst.mockResolvedValue(null);

    await expect(getRepositoryForkNetwork('alice', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });
  });

  it('authorizes access before reading network', async () => {
    await getRepositoryForkNetwork('alice', 'project', 'user-1');

    expect(authorize).toHaveBeenCalledWith('repo-1', 'READ', 'user-1');
  });

  it('returns parent metadata when accessible', async () => {
    findFirst.mockResolvedValue({
      id: 'fork-1',
      name: 'copy',
      ownerId: 'owner-2',
      isPrivate: false,
      forkedFromId: 'repo-1',
    } as never);

    findUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'project',
      isPrivate: false,
      owner: { username: 'alice' },
    } as never);

    const result = await getRepositoryForkNetwork('bob', 'copy');

    expect(result.isFork).toBe(true);
    expect(result.parent).toEqual({
      id: 'repo-1',
      name: 'project',
      owner: 'alice',
    });
  });

  it('returns visible forks', async () => {
    findMany.mockResolvedValue([
      {
        id: 'fork-1',
        name: 'copy',
        owner: { username: 'bob' },
      },
    ] as never);
    count.mockResolvedValue(1);

    const result = await getRepositoryForkNetwork('alice', 'project');

    expect(result.forkCount).toBe(1);
    expect(result.totalForkCount).toBe(1);
    expect(result.forks[0]).toEqual({
      id: 'fork-1',
      name: 'copy',
      owner: 'bob',
    });
  });

  it('marks pagination when more than 100 visible forks exist', async () => {
    count.mockResolvedValue(101);

    const result = await getRepositoryForkNetwork('alice', 'project');

    expect(result.hasMore).toBe(true);
  });
});
