import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { getRepositoryStarCount } from '../../../src/services/repositories/repository-star.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-star.service.js', () => ({
  starRepository: vi.fn(),
  unstarRepository: vi.fn(),
  getRepositoryStarCount: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token !== 'test-access-token') {
      throw new Error('Invalid token');
    }

    return { sub: 'user-1' };
  }),
}));

const mockedGetStarCount = vi.mocked(getRepositoryStarCount);

const endpoint = '/api/repositories/asil/demo/stars/count';

describe('repository star count HTTP integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns star count for a public repository without authentication', async () => {
    mockedGetStarCount.mockResolvedValue({
      repositoryId: 'repo-1',
      starCount: 12,
    });

    const response = await request(app).get(endpoint);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        repositoryId: 'repo-1',
        starCount: 12,
      },
    });

    expect(mockedGetStarCount).toHaveBeenCalledWith(
      'asil',
      'demo',
      undefined,
    );
  });

  it('passes authenticated user ID to the service', async () => {
    mockedGetStarCount.mockResolvedValue({
      repositoryId: 'repo-1',
      starCount: 3,
    });

    const response = await request(app)
      .get(endpoint)
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(200);
    expect(response.body.data.starCount).toBe(3);

    expect(mockedGetStarCount).toHaveBeenCalledWith(
      'asil',
      'demo',
      'user-1',
    );
  });

  it('returns zero when a repository has no stars', async () => {
    mockedGetStarCount.mockResolvedValue({
      repositoryId: 'repo-1',
      starCount: 0,
    });

    const response = await request(app).get(endpoint);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        repositoryId: 'repo-1',
        starCount: 0,
      },
    });
  });

  it('rejects an invalid bearer token', async () => {
    const response = await request(app)
      .get(endpoint)
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_ACCESS_TOKEN',
      },
    });

    expect(mockedGetStarCount).not.toHaveBeenCalled();
  });

  it('rejects a malformed authorization header', async () => {
    const response = await request(app)
      .get(endpoint)
      .set('Authorization', 'Basic invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_AUTHORIZATION_HEADER',
      },
    });

    expect(mockedGetStarCount).not.toHaveBeenCalled();
  });

  it('returns 404 when the repository does not exist', async () => {
    mockedGetStarCount.mockRejectedValue(
      new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND'),
    );

    const response = await request(app)
      .get('/api/repositories/asil/missing/stars/count');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_NOT_FOUND',
      },
    });
  });

  it('returns 403 for unauthorized private repository access', async () => {
    mockedGetStarCount.mockRejectedValue(
      new AppError(
        'You do not have permission to access this repository',
        403,
        'REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .get('/api/repositories/asil/private/stars/count');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_ACCESS_DENIED',
      },
    });
  });

  it('returns 500 when the database operation fails', async () => {
    mockedGetStarCount.mockRejectedValue(
      new Error('Database unavailable'),
    );

    const response = await request(app).get(endpoint);

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
    });
  });
});
