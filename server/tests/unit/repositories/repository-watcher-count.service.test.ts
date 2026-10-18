import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  count: vi.fn(),
  authorizeRepositoryAccess: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: mocks.findFirst,
    },
    repositoryWatch: {
      count: mocks.count,
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: mocks.authorizeRepositoryAccess,
}));

import { getRepositoryWatcherCount } from '../../../src/services/repositories/repository-watch.service.js';

describe('getRepositoryWatcherCount', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findFirst.mockResolvedValue({ id: 'repo-1' });
    mocks.authorizeRepositoryAccess.mockResolvedValue(undefined);
    mocks.count.mockResolvedValue(3);
  });

  it('counts watchers for a public repository', async () => {
    await expect(getRepositoryWatcherCount('asil', 'demo')).resolves.toEqual({
      repositoryId: 'repo-1',
      watcherCount: 3,
    });

    expect(mocks.count).toHaveBeenCalledExactlyOnceWith({
      where: { repositoryId: 'repo-1' },
    });
  });

  it('looks up repository by owner username and name', async () => {
    await getRepositoryWatcherCount('asil', 'demo');

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        name: 'demo',
        owner: { username: 'asil' },
      },
      select: { id: true },
    });
  });

  it('supports zero watchers', async () => {
    mocks.count.mockResolvedValue(0);

    await expect(getRepositoryWatcherCount('asil', 'demo')).resolves.toEqual({
      repositoryId: 'repo-1',
      watcherCount: 0,
    });
  });

  it('passes authenticated viewer ID to READ authorization', async () => {
    await getRepositoryWatcherCount('asil', 'demo', 'viewer-1');

    expect(mocks.authorizeRepositoryAccess).toHaveBeenCalledWith('repo-1', 'READ', 'viewer-1');
  });

  it('supports anonymous READ authorization', async () => {
    await getRepositoryWatcherCount('asil', 'demo');

    expect(mocks.authorizeRepositoryAccess).toHaveBeenCalledWith('repo-1', 'READ', undefined);
  });

  it('rejects missing repositories before counting', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(getRepositoryWatcherCount('asil', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('does not expose private counts without READ access', async () => {
    mocks.authorizeRepositoryAccess.mockRejectedValue(
      Object.assign(new Error('Access denied'), {
        statusCode: 403,
        code: 'REPOSITORY_ACCESS_DENIED',
      }),
    );

    await expect(getRepositoryWatcherCount('asil', 'private', 'viewer-1')).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('propagates database count errors', async () => {
    const error = new Error('Database unavailable');
    mocks.count.mockRejectedValue(error);

    await expect(getRepositoryWatcherCount('asil', 'demo')).rejects.toBe(error);
  });
});
