import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
  authorizeRepositoryAccess: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: mocks.findFirst,
    },
    repositoryWatch: {
      deleteMany: mocks.deleteMany,
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: mocks.authorizeRepositoryAccess,
}));

import { unwatchRepository } from '../../../src/services/repositories/repository-watch.service.js';

describe('unwatchRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.findFirst.mockResolvedValue({ id: 'repo-1' });
    mocks.authorizeRepositoryAccess.mockResolvedValue({
      repositoryId: 'repo-1',
      permission: 'PUBLIC',
    });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });

  it('removes a watch from an accessible repository', async () => {
    const result = await unwatchRepository('user-1', 'owner', 'project');

    expect(result).toEqual({
      repositoryId: 'repo-1',
      watching: false,
    });

    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        userId: 'user-1',
        repositoryId: 'repo-1',
      },
    });
  });

  it('is idempotent when the repository is already unwatched', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });

    const first = await unwatchRepository('user-1', 'owner', 'project');
    const second = await unwatchRepository('user-1', 'owner', 'project');

    expect(first).toEqual({
      repositoryId: 'repo-1',
      watching: false,
    });

    expect(second).toEqual(first);
    expect(mocks.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('returns 404 when the repository does not exist', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(unwatchRepository('user-1', 'owner', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(mocks.authorizeRepositoryAccess).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('denies unwatch when private repository access is forbidden', async () => {
    mocks.authorizeRepositoryAccess.mockRejectedValue(
      Object.assign(new Error('Access denied'), {
        statusCode: 403,
        code: 'REPOSITORY_ACCESS_DENIED',
      }),
    );

    await expect(unwatchRepository('stranger-1', 'owner', 'private-project')).rejects.toMatchObject(
      {
        statusCode: 403,
        code: 'REPOSITORY_ACCESS_DENIED',
      },
    );

    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('authorizes before deleting the watch record', async () => {
    await unwatchRepository('user-1', 'owner', 'project');

    const authOrder = mocks.authorizeRepositoryAccess.mock.invocationCallOrder[0];
    const deleteOrder = mocks.deleteMany.mock.invocationCallOrder[0];

    expect(authOrder).toBeDefined();
    expect(deleteOrder).toBeDefined();
    expect(authOrder!).toBeLessThan(deleteOrder!);
  });

  it('looks up the correct repository and checks READ access', async () => {
    await unwatchRepository('viewer-7', 'repository-owner', 'backend');

    expect(mocks.findFirst).toHaveBeenCalledExactlyOnceWith({
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

    expect(mocks.authorizeRepositoryAccess).toHaveBeenCalledExactlyOnceWith(
      'repo-1',
      'READ',
      'viewer-7',
    );

    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        userId: 'viewer-7',
        repositoryId: 'repo-1',
      },
    });
  });

  it('propagates database errors without reporting success', async () => {
    mocks.deleteMany.mockRejectedValue(new Error('Database unavailable'));

    await expect(unwatchRepository('user-1', 'owner', 'project')).rejects.toThrow(
      'Database unavailable',
    );
  });
});
