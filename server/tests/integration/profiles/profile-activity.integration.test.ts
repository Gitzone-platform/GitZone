import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { getUserPublicActivity } from '../../../src/services/profiles/profile-activity.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/profiles/profile.service.js', () => ({
  getPublicUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository.service.js', () => ({
  getUserRepositories: vi.fn(),
}));

vi.mock('../../../src/services/profiles/profile-activity.service.js', () => ({
  getUserPublicActivity: vi.fn(),
}));

const mockedGetActivity = vi.mocked(getUserPublicActivity);

const publicActivity = {
  id: 'issue-1',
  type: 'ISSUE_CREATED' as const,
  repository: {
    id: 'repo-1',
    name: 'gitzone',
  },
  number: 1,
  title: 'Fix login issue',
  createdAt: new Date('2026-10-09T12:00:00.000Z'),
};

describe('public profile activity API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns public activity for an existing user', async () => {
    mockedGetActivity.mockResolvedValue({
      activities: [publicActivity],
    });

    const response = await request(app).get('/api/users/asil/activity');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        activities: [
          {
            id: 'issue-1',
            type: 'ISSUE_CREATED',
            repository: {
              id: 'repo-1',
              name: 'gitzone',
            },
            number: 1,
            title: 'Fix login issue',
            createdAt: '2026-10-09T12:00:00.000Z',
          },
        ],
      },
    });

    expect(mockedGetActivity).toHaveBeenCalledWith('asil');
  });

  it('returns an empty activity list', async () => {
    mockedGetActivity.mockResolvedValue({
      activities: [],
    });

    const response = await request(app).get('/api/users/asil/activity');

    expect(response.status).toBe(200);
    expect(response.body.data.activities).toEqual([]);
  });

  it('returns 404 for a nonexistent user', async () => {
    mockedGetActivity.mockRejectedValue(new AppError('User not found', 404, 'USER_NOT_FOUND'));

    const response = await request(app).get('/api/users/missinguser/activity');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'USER_NOT_FOUND',
      },
    });
  });

  it('rejects invalid usernames', async () => {
    const response = await request(app).get('/api/users/invalid.username/activity');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_USERNAME',
      },
    });

    expect(mockedGetActivity).not.toHaveBeenCalled();
  });

  it('does not require an authorization header', async () => {
    mockedGetActivity.mockResolvedValue({
      activities: [publicActivity],
    });

    const response = await request(app).get('/api/users/asil/activity');

    expect(response.status).toBe(200);
    expect(mockedGetActivity).toHaveBeenCalledOnce();
  });

  it('propagates activity service errors through middleware', async () => {
    mockedGetActivity.mockRejectedValue(
      new AppError('Activity query failed', 503, 'ACTIVITY_QUERY_FAILED'),
    );

    const response = await request(app).get('/api/users/asil/activity');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('ACTIVITY_QUERY_FAILED');
  });

  it('does not expose sensitive user information', async () => {
    mockedGetActivity.mockResolvedValue({
      activities: [publicActivity],
    });

    const response = await request(app).get('/api/users/asil/activity');

    expect(response.status).toBe(200);

    const activity = response.body.data.activities[0];

    expect(activity).not.toHaveProperty('email');
    expect(activity).not.toHaveProperty('password');
    expect(activity).not.toHaveProperty('sessions');
    expect(activity).not.toHaveProperty('accessToken');
    expect(activity.repository).not.toHaveProperty('isPrivate');
  });
});
