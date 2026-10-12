import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { unwatchRepository } from '../../../src/services/repositories/repository-watch.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-watch.service.js', () => ({
  watchRepository: vi.fn(),
  unwatchRepository: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token !== 'test-access-token') {
      throw new Error('Invalid token');
    }

    return { sub: 'user-1' };
  }),
}));

const mockedUnwatchRepository = vi.mocked(unwatchRepository);

const unwatchUrl = '/api/repositories/asil/demo/watch';

describe('repository unwatch HTTP integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('unwatches a repository with a valid bearer token', async () => {
    mockedUnwatchRepository.mockResolvedValue({
      repositoryId: 'repo-1',
      watching: false,
    });

    const response = await request(app)
      .delete(unwatchUrl)
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        repositoryId: 'repo-1',
        watching: false,
      },
    });

    expect(mockedUnwatchRepository).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      'asil',
      'demo',
    );
  });

  it('returns the same result for repeated unwatch requests', async () => {
    mockedUnwatchRepository.mockResolvedValue({
      repositoryId: 'repo-1',
      watching: false,
    });

    const first = await request(app)
      .delete(unwatchUrl)
      .set('Authorization', 'Bearer test-access-token');

    const second = await request(app)
      .delete(unwatchUrl)
      .set('Authorization', 'Bearer test-access-token');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(mockedUnwatchRepository).toHaveBeenCalledTimes(2);
  });

  it('requires authentication', async () => {
    const response = await request(app).delete(unwatchUrl);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'AUTHORIZATION_REQUIRED',
      },
    });

    expect(mockedUnwatchRepository).not.toHaveBeenCalled();
  });

  it('rejects an invalid bearer token', async () => {
    const response = await request(app)
      .delete(unwatchUrl)
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_ACCESS_TOKEN',
      },
    });

    expect(mockedUnwatchRepository).not.toHaveBeenCalled();
  });

  it('rejects a malformed authorization header', async () => {
    const response = await request(app)
      .delete(unwatchUrl)
      .set('Authorization', 'Basic test-access-token');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_AUTHORIZATION_HEADER',
      },
    });

    expect(mockedUnwatchRepository).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing repository', async () => {
    mockedUnwatchRepository.mockRejectedValue(
      new AppError(
        'Repository not found',
        404,
        'REPOSITORY_NOT_FOUND',
      ),
    );

    const response = await request(app)
      .delete('/api/repositories/asil/missing/watch')
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_NOT_FOUND',
      },
    });

    expect(mockedUnwatchRepository).toHaveBeenCalledWith(
      'user-1',
      'asil',
      'missing',
    );
  });

  it('returns 403 when private repository access is denied', async () => {
    mockedUnwatchRepository.mockRejectedValue(
      new AppError(
        'You do not have permission to access this repository',
        403,
        'REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .delete('/api/repositories/asil/private/watch')
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_ACCESS_DENIED',
      },
    });

    expect(mockedUnwatchRepository).toHaveBeenCalledWith(
      'user-1',
      'asil',
      'private',
    );
  });
});
