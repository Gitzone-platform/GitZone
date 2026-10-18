import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { getUserRepositories } from '../../../src/services/repositories/repository.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findMany: vi.fn(),
    },
  },
}));

const mockedFindMany = vi.mocked(prisma.repository.findMany);

const publicRepository = {
  id: 'repo-public',
  ownerId: 'user-1',
  name: 'public-project',
  description: 'Public repository',
  isPrivate: false,
  defaultBranch: 'main',
  createdAt: new Date('2026-10-09T12:00:00.000Z'),
  updatedAt: new Date('2026-10-09T12:00:00.000Z'),
};

describe('public profile repository privacy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('filters private repositories at the database query level', async () => {
    mockedFindMany.mockResolvedValue([]);

    await getUserRepositories('asil');

    expect(mockedFindMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        owner: {
          username: 'asil',
        },
        isPrivate: false,
        organizationId: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  });

  it('returns only repositories selected by the public query', async () => {
    mockedFindMany.mockResolvedValue([publicRepository] as never);

    const result = await getUserRepositories('asil');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'repo-public',
      name: 'public-project',
      isPrivate: false,
    });
  });

  it('does not expose repository relations or internal fields', async () => {
    mockedFindMany.mockResolvedValue([
      {
        ...publicRepository,
        internalSecret: 'must-not-leak',
        collaborators: [{ userId: 'private-user' }],
        owner: {
          email: 'private@example.com',
          password: 'secret-hash',
        },
      },
    ] as never);

    const result = await getUserRepositories('asil');

    expect(result[0]).not.toHaveProperty('internalSecret');
    expect(result[0]).not.toHaveProperty('collaborators');
    expect(result[0]).not.toHaveProperty('owner');
  });

  it('returns an empty array when no public repositories exist', async () => {
    mockedFindMany.mockResolvedValue([]);

    const result = await getUserRepositories('asil');

    expect(result).toEqual([]);
  });
});
