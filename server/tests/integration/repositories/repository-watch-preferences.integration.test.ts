import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { updateRepositoryWatchPreference } from '../../../src/services/repositories/repository-watch.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-watch.service.js', () => ({
  watchRepository: vi.fn(),
  unwatchRepository: vi.fn(),
  updateRepositoryWatchPreference: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token !== 'test-access-token') {
      throw new Error('Invalid token');
    }

    return { sub: 'user-1' };
  }),
}));

const mockedUpdate = vi.mocked(updateRepositoryWatchPreference);

const url = '/api/repositories/asil/demo/watch/preferences';
const token = 'Bearer test-access-token';

describe('repository watch preferences HTTP integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each(['ALL', 'PARTICIPATING', 'IGNORE'] as const)(
    'updates preference to %s',
    async (preference) => {
      mockedUpdate.mockResolvedValue({
        repositoryId: 'repo-1',
        watching: true,
        preference,
      });

      const response = await request(app)
        .patch(url)
        .set('Authorization', token)
        .send({ preference });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: {
          repositoryId: 'repo-1',
          watching: true,
          preference,
        },
      });

      expect(mockedUpdate).toHaveBeenCalledExactlyOnceWith('user-1', 'asil', 'demo', preference);
    },
  );

  it.each([
    {},
    { preference: 'INVALID' },
    { preference: 'all' },
    { preference: null },
    { preference: 123 },
    { preference: 'ALL', unexpected: true },
  ])('rejects invalid body %#', async (body) => {
    const response = await request(app).patch(url).set('Authorization', token).send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_WATCH_PREFERENCE' },
    });

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const response = await request(app).patch(url).send({ preference: 'ALL' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'AUTHORIZATION_REQUIRED' },
    });

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid bearer tokens', async () => {
    const response = await request(app)
      .patch(url)
      .set('Authorization', 'Bearer invalid-token')
      .send({ preference: 'ALL' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_ACCESS_TOKEN' },
    });

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed authorization headers', async () => {
    const response = await request(app)
      .patch(url)
      .set('Authorization', 'Basic test-access-token')
      .send({ preference: 'ALL' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_AUTHORIZATION_HEADER' },
    });

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when repository does not exist', async () => {
    mockedUpdate.mockRejectedValue(
      new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND'),
    );

    const response = await request(app)
      .patch('/api/repositories/asil/missing/watch/preferences')
      .set('Authorization', token)
      .send({ preference: 'ALL' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('REPOSITORY_NOT_FOUND');
  });

  it('returns 404 when watch does not exist', async () => {
    mockedUpdate.mockRejectedValue(
      new AppError('Repository watch not found', 404, 'WATCH_NOT_FOUND'),
    );

    const response = await request(app)
      .patch(url)
      .set('Authorization', token)
      .send({ preference: 'IGNORE' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('WATCH_NOT_FOUND');
  });

  it('returns 403 for unauthorized private repositories', async () => {
    mockedUpdate.mockRejectedValue(
      new AppError(
        'You do not have permission to access this repository',
        403,
        'REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .patch(url)
      .set('Authorization', token)
      .send({ preference: 'PARTICIPATING' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('REPOSITORY_ACCESS_DENIED');
  });

  it('propagates unexpected service errors through error middleware', async () => {
    mockedUpdate.mockRejectedValue(new Error('Unexpected database error'));

    const response = await request(app)
      .patch(url)
      .set('Authorization', token)
      .send({ preference: 'ALL' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
    });
  });
});
