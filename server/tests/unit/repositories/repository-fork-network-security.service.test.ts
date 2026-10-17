import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { AppError } from '../../../src/errors/app.error.js';
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

describe('repository fork network privacy', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findFirst.mockResolvedValue({
      id: 'fork-1',
      name: 'copy',
      ownerId: 'user-1',
      isPrivate: false,
      forkedFromId: 'private-parent',
    } as never);

    findUnique.mockResolvedValue({
      id: 'private-parent',
      name: 'secret-project',
      isPrivate: true,
      owner: { username: 'alice' },
    } as never);

    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    authorize.mockResolvedValue({} as never);
  });

  it('hides inaccessible private parent metadata', async () => {
    authorize.mockImplementation(async (id) => {
      if (id === 'private-parent') {
        throw new AppError('Forbidden', 403, 'REPOSITORY_ACCESS_DENIED');
      }
      return {} as never;
    });

    const result = await getRepositoryForkNetwork('bob', 'copy');

    expect(result.parent).toBeNull();
    expect(result.parentAccessible).toBe(false);
  });

  it('does not query network when repository itself is inaccessible', async () => {
    authorize.mockRejectedValue(new AppError('Forbidden', 403, 'REPOSITORY_ACCESS_DENIED'));

    await expect(getRepositoryForkNetwork('bob', 'copy')).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    expect(findUnique).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('filters private forks for anonymous users', async () => {
    findFirst.mockResolvedValue({
      id: 'repo-1',
      name: 'project',
      ownerId: 'alice-1',
      isPrivate: false,
      forkedFromId: null,
    } as never);

    await getRepositoryForkNetwork('alice', 'project');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          forkedFromId: 'repo-1',
          organizationId: null,
          isPrivate: false,
        },
      }),
    );

    expect(count).toHaveBeenCalledWith({
      where: {
        forkedFromId: 'repo-1',
        organizationId: null,
        isPrivate: false,
      },
    });
  });

  it('allows authenticated users to see their own private forks', async () => {
    findFirst.mockResolvedValue({
      id: 'repo-1',
      name: 'project',
      ownerId: 'alice-1',
      isPrivate: false,
      forkedFromId: null,
    } as never);

    await getRepositoryForkNetwork('alice', 'project', 'user-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          forkedFromId: 'repo-1',
          organizationId: null,
          OR: [
            { isPrivate: false },
            { ownerId: 'user-1' },
            { collaborators: { some: { userId: 'user-1' } } },
          ],
        },
      }),
    );
  });
});
