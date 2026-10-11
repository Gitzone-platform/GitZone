import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { starRepository } from '../../../src/services/repositories/repository-star.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-star.service.js', () => ({
  starRepository: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token !== 'test-access-token') {
      throw new Error('Invalid token');
    }

    return { sub: 'user-1' };
  }),
}));

const mockedStarRepository = vi.mocked(starRepository);

describe('repository star HTTP integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('stars a repository with a valid bearer token', async () => {
    mockedStarRepository.mockResolvedValue({
      repositoryId: 'repo-1',
      starred: true,
    });

    const response = await request(app)
      .post('/api/repositories/asil/demo/star')
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        repositoryId: 'repo-1',
        starred: true,
      },
    });

    expect(mockedStarRepository).toHaveBeenCalledWith(
      'user-1',
      'asil',
      'demo',
    );
  });

  it('returns the same successful result for repeated requests', async () => {
    mockedStarRepository.mockResolvedValue({
      repositoryId: 'repo-1',
      starred: true,
    });

    const first = await request(app)
      .post('/api/repositories/asil/demo/star')
      .set('Authorization', 'Bearer test-access-token');

    const second = await request(app)
      .post('/api/repositories/asil/demo/star')
      .set('Authorization', 'Bearer test-access-token');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(mockedStarRepository).toHaveBeenCalledTimes(2);
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/star');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'AUTHORIZATION_REQUIRED',
      },
    });

    expect(mockedStarRepository).not.toHaveBeenCalled();
  });

  it('rejects an invalid bearer token', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/star')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_ACCESS_TOKEN',
      },
    });

    expect(mockedStarRepository).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing repository', async () => {
    mockedStarRepository.mockRejectedValue(
      new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND'),
    );

    const response = await request(app)
      .post('/api/repositories/asil/missing/star')
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_NOT_FOUND',
      },
    });
  });

  it('returns 403 when private repository access is denied', async () => {
    mockedStarRepository.mockRejectedValue(
      new AppError(
        'You do not have permission to access this repository',
        403,
        'REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .post('/api/repositories/asil/private/star')
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_ACCESS_DENIED',
      },
    });
  });
});
