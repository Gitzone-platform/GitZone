import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { watchRepository } from '../../../src/services/repositories/repository-watch.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-watch.service.js', () => ({
  watchRepository: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token !== 'test-access-token') {
      throw new Error('Invalid token');
    }

    return { sub: 'user-1' };
  }),
}));

const mockedWatchRepository = vi.mocked(watchRepository);

const watchUrl = '/api/repositories/asil/demo/watch';

describe('repository watch HTTP integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('watches a repository with a valid bearer token', async () => {
    mockedWatchRepository.mockResolvedValue({
      repositoryId: 'repo-1',
      watching: true,
    });

    const response = await request(app)
      .post(watchUrl)
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        repositoryId: 'repo-1',
        watching: true,
      },
    });

    expect(mockedWatchRepository).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      'asil',
      'demo',
    );
  });

  it('returns the same result for repeated watch requests', async () => {
    mockedWatchRepository.mockResolvedValue({
      repositoryId: 'repo-1',
      watching: true,
    });

    const first = await request(app)
      .post(watchUrl)
      .set('Authorization', 'Bearer test-access-token');

    const second = await request(app)
      .post(watchUrl)
      .set('Authorization', 'Bearer test-access-token');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(mockedWatchRepository).toHaveBeenCalledTimes(2);
  });

  it('requires authentication', async () => {
    const response = await request(app).post(watchUrl);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'AUTHORIZATION_REQUIRED',
      },
    });

    expect(mockedWatchRepository).not.toHaveBeenCalled();
  });

  it('rejects an invalid bearer token', async () => {
    const response = await request(app)
      .post(watchUrl)
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_ACCESS_TOKEN',
      },
    });

    expect(mockedWatchRepository).not.toHaveBeenCalled();
  });

  it('rejects a malformed authorization header', async () => {
    const response = await request(app)
      .post(watchUrl)
      .set('Authorization', 'Basic test-access-token');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_AUTHORIZATION_HEADER',
      },
    });

    expect(mockedWatchRepository).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing repository', async () => {
    mockedWatchRepository.mockRejectedValue(
      new AppError(
        'Repository not found',
        404,
        'REPOSITORY_NOT_FOUND',
      ),
    );

    const response = await request(app)
      .post('/api/repositories/asil/missing/watch')
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_NOT_FOUND',
      },
    });

    expect(mockedWatchRepository).toHaveBeenCalledWith(
      'user-1',
      'asil',
      'missing',
    );
  });

  it('returns 403 when private repository access is denied', async () => {
    mockedWatchRepository.mockRejectedValue(
      new AppError(
        'You do not have permission to access this repository',
        403,
        'REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .post('/api/repositories/asil/private/watch')
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_ACCESS_DENIED',
      },
    });

    expect(mockedWatchRepository).toHaveBeenCalledWith(
      'user-1',
      'asil',
      'private',
    );
  });
});
