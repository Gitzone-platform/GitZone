import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { getRepositoryWatcherCount } from '../../../src/services/repositories/repository-watch.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-watch.service.js', () => ({
  watchRepository: vi.fn(),
  unwatchRepository: vi.fn(),
  updateRepositoryWatchPreference: vi.fn(),
  getRepositoryWatcherCount: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token !== 'test-access-token') {
      throw new Error('Invalid token');
    }

    return { sub: 'viewer-1' };
  }),
}));

const mockedCount = vi.mocked(getRepositoryWatcherCount);
const url = '/api/repositories/asil/demo/watchers/count';

describe('repository watcher count HTTP integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns watcher count anonymously', async () => {
    mockedCount.mockResolvedValue({
      repositoryId: 'repo-1',
      watcherCount: 4,
    });

    const response = await request(app).get(url);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        repositoryId: 'repo-1',
        watcherCount: 4,
      },
    });

    expect(mockedCount).toHaveBeenCalledExactlyOnceWith(
      'asil',
      'demo',
      undefined,
    );
  });

  it('passes authenticated viewer identity', async () => {
    mockedCount.mockResolvedValue({
      repositoryId: 'repo-1',
      watcherCount: 2,
    });

    const response = await request(app)
      .get(url)
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(200);

    expect(mockedCount).toHaveBeenCalledExactlyOnceWith(
      'asil',
      'demo',
      'viewer-1',
    );
  });

  it('returns zero watcher count', async () => {
    mockedCount.mockResolvedValue({
      repositoryId: 'repo-1',
      watcherCount: 0,
    });

    const response = await request(app).get(url);

    expect(response.status).toBe(200);
    expect(response.body.data.watcherCount).toBe(0);
  });

  it('rejects invalid bearer tokens', async () => {
    const response = await request(app)
      .get(url)
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    expect(mockedCount).not.toHaveBeenCalled();
  });

  it('rejects malformed authorization headers', async () => {
    const response = await request(app)
      .get(url)
      .set('Authorization', 'Basic test-access-token');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(
      'INVALID_AUTHORIZATION_HEADER',
    );

    expect(mockedCount).not.toHaveBeenCalled();
  });

  it('returns 404 for missing repositories', async () => {
    mockedCount.mockRejectedValue(
      new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND'),
    );

    const response = await request(app).get(url);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('REPOSITORY_NOT_FOUND');
  });

  it('returns 403 for inaccessible private repositories', async () => {
    mockedCount.mockRejectedValue(
      new AppError(
        'You do not have permission to access this repository',
        403,
        'REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .get(url)
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('REPOSITORY_ACCESS_DENIED');
  });
});
