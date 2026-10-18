import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { getUserStarredRepositories } from '../../../src/services/profiles/profile-starred.service.js';
import { verifyAccessToken } from '../../../src/utils/auth/tokens.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/profiles/profile-starred.service.js', () => ({
  getUserStarredRepositories: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/utils/auth/tokens.js')>();

  return {
    ...original,
    verifyAccessToken: vi.fn(),
  };
});

const mockedService = vi.mocked(getUserStarredRepositories);
const mockedVerifyToken = vi.mocked(verifyAccessToken);

const result = {
  repositories: [
    {
      id: 'repo-1',
      name: 'gitzone',
      description: 'Git hosting',
      isPrivate: false,
      defaultBranch: 'main',
      starredAt: '2026-10-10T12:00:00.000Z',
      owner: {
        id: 'owner-1',
        username: 'owner',
        name: 'Owner',
        avatarUrl: null,
      },
    },
  ],
  pagination: {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  },
};

describe('GET /api/users/:username/starred', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedService.mockResolvedValue(result as never);
  });

  it('returns starred repositories without authentication', async () => {
    const response = await request(app).get('/api/users/asil/starred');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: result,
    });

    expect(mockedService).toHaveBeenCalledExactlyOnceWith('asil', undefined, {
      page: 1,
      limit: 20,
    });
  });

  it('passes validated pagination to the service', async () => {
    const response = await request(app).get('/api/users/asil/starred?page=3&limit=5');

    expect(response.status).toBe(200);

    expect(mockedService).toHaveBeenCalledWith('asil', undefined, { page: 3, limit: 5 });
  });

  it('passes authenticated viewer ID to the service', async () => {
    mockedVerifyToken.mockReturnValue({
      sub: 'viewer-1',
    } as never);

    const response = await request(app)
      .get('/api/users/asil/starred')
      .set('Authorization', 'Bearer valid-test-token');

    expect(response.status).toBe(200);
    expect(mockedVerifyToken).toHaveBeenCalledWith('valid-test-token');

    expect(mockedService).toHaveBeenCalledWith('asil', 'viewer-1', { page: 1, limit: 20 });
  });

  it('rejects an invalid username', async () => {
    const response = await request(app).get('/api/users/invalid.username/starred');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_USERNAME');
    expect(mockedService).not.toHaveBeenCalled();
  });

  it('rejects invalid pagination parameters', async () => {
    const response = await request(app).get('/api/users/asil/starred?page=0&limit=101');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_STARRED_QUERY');
    expect(mockedService).not.toHaveBeenCalled();
  });

  it('rejects unexpected query parameters', async () => {
    const response = await request(app).get('/api/users/asil/starred?includePrivate=true');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_STARRED_QUERY');
    expect(mockedService).not.toHaveBeenCalled();
  });

  it('returns 404 when the profile does not exist', async () => {
    mockedService.mockRejectedValue(new AppError('User not found', 404, 'USER_NOT_FOUND'));

    const response = await request(app).get('/api/users/missinguser/starred');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns an empty list with pagination', async () => {
    mockedService.mockResolvedValue({
      repositories: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    });

    const response = await request(app).get('/api/users/asil/starred');

    expect(response.status).toBe(200);
    expect(response.body.data.repositories).toEqual([]);
    expect(response.body.data.pagination.total).toBe(0);
  });

  it('rejects malformed authorization headers', async () => {
    const response = await request(app)
      .get('/api/users/asil/starred')
      .set('Authorization', 'Basic invalid');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_AUTHORIZATION_HEADER');
    expect(mockedService).not.toHaveBeenCalled();
  });

  it('propagates service failures through error middleware', async () => {
    mockedService.mockRejectedValue(new AppError('Query failed', 503, 'STARRED_QUERY_FAILED'));

    const response = await request(app).get('/api/users/asil/starred');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('STARRED_QUERY_FAILED');
  });
});
