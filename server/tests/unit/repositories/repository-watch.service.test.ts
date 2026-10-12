import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  upsert: vi.fn(),
  authorizeRepositoryAccess: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: mocks.findFirst,
    },
    repositoryWatch: {
      upsert: mocks.upsert,
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: mocks.authorizeRepositoryAccess,
}));

import { watchRepository } from '../../../src/services/repositories/repository-watch.service.js';

describe('watchRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.findFirst.mockResolvedValue({ id: 'repo-1' });
    mocks.authorizeRepositoryAccess.mockResolvedValue({
      repositoryId: 'repo-1',
      permission: 'PUBLIC',
    });
    mocks.upsert.mockResolvedValue({
      id: 'watch-1',
      userId: 'user-1',
      repositoryId: 'repo-1',
    });
  });

  it('watches an accessible repository', async () => {
    const result = await watchRepository('user-1', 'owner', 'project');

    expect(result).toEqual({
      repositoryId: 'repo-1',
      watching: true,
    });

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it('uses an idempotent upsert with a composite unique key', async () => {
    await watchRepository('user-1', 'owner', 'project');
    await watchRepository('user-1', 'owner', 'project');

    expect(mocks.upsert).toHaveBeenCalledTimes(2);

    expect(mocks.upsert).toHaveBeenCalledWith({
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
  });

  it('rejects a repository that does not exist', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(watchRepository('user-1', 'owner', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(mocks.authorizeRepositoryAccess).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects unauthorized access to a private repository', async () => {
    mocks.authorizeRepositoryAccess.mockRejectedValue(
      Object.assign(new Error('Access denied'), {
        statusCode: 403,
        code: 'REPOSITORY_ACCESS_DENIED',
      }),
    );

    await expect(watchRepository('user-1', 'owner', 'private-project')).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('authorizes before writing the watch record', async () => {
    await watchRepository('user-1', 'owner', 'project');

    const authOrder = mocks.authorizeRepositoryAccess.mock.invocationCallOrder[0];

    const upsertOrder = mocks.upsert.mock.invocationCallOrder[0];

    expect(authOrder).toBeDefined();
    expect(upsertOrder).toBeDefined();
    expect(authOrder!).toBeLessThan(upsertOrder!);
  });

  it('looks up the owner and checks READ access for the correct user', async () => {
    await watchRepository('viewer-7', 'repository-owner', 'backend');

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        name: 'backend',
        owner: {
          username: 'repository-owner',
        },
      },
      select: {
        id: true,
      },
    });

    expect(mocks.authorizeRepositoryAccess).toHaveBeenCalledWith('repo-1', 'READ', 'viewer-7');
  });

  it('propagates database errors without reporting success', async () => {
    mocks.upsert.mockRejectedValue(new Error('Database unavailable'));

    await expect(watchRepository('user-1', 'owner', 'project')).rejects.toThrow(
      'Database unavailable',
    );
  });
});
