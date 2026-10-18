import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { getUserPublicContributions } from '../../../src/services/profiles/profile-contributions.service.js';

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

vi.mock('../../../src/services/profiles/profile-contributions.service.js', () => ({
  getUserPublicContributions: vi.fn(),
}));

const mockedGetContributions = vi.mocked(getUserPublicContributions);

const buildContributions = () => {
  const start = Date.parse('2025-10-10T00:00:00.000Z');

  const days = Array.from({ length: 365 }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    count: index === 364 ? 2 : 0,
  }));

  return {
    from: '2025-10-10',
    to: '2026-10-09',
    total: 2,
    activeDays: 1,
    longestStreak: 1,
    currentStreak: 1,
    breakdown: {
      repositories: 1,
      issues: 1,
      pullRequests: 0,
    },
    days,
  };
};

describe('public profile contributions API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns contributions for an existing user', async () => {
    mockedGetContributions.mockResolvedValue(buildContributions());

    const response = await request(app).get('/api/users/asil/contributions');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        from: '2025-10-10',
        to: '2026-10-09',
        total: 2,
        activeDays: 1,
        longestStreak: 1,
        currentStreak: 1,
        breakdown: {
          repositories: 1,
          issues: 1,
          pullRequests: 0,
        },
      },
    });

    expect(mockedGetContributions).toHaveBeenCalledWith('asil');
  });

  it('returns 365 daily contribution entries', async () => {
    mockedGetContributions.mockResolvedValue(buildContributions());

    const response = await request(app).get('/api/users/asil/contributions');

    expect(response.status).toBe(200);
    expect(response.body.data.days).toHaveLength(365);
    expect(response.body.data.days[0]).toEqual({
      date: '2025-10-10',
      count: 0,
    });
    expect(response.body.data.days[364]).toEqual({
      date: '2026-10-09',
      count: 2,
    });
  });

  it('returns empty contribution statistics', async () => {
    const empty = buildContributions();

    mockedGetContributions.mockResolvedValue({
      ...empty,
      total: 0,
      activeDays: 0,
      longestStreak: 0,
      currentStreak: 0,
      breakdown: {
        repositories: 0,
        issues: 0,
        pullRequests: 0,
      },
      days: empty.days.map((day) => ({
        ...day,
        count: 0,
      })),
    });

    const response = await request(app).get('/api/users/asil/contributions');

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(0);
    expect(response.body.data.activeDays).toBe(0);
    expect(response.body.data.days).toHaveLength(365);
    expect(response.body.data.days.every((day: { count: number }) => day.count === 0)).toBe(true);
  });

  it('returns 404 for a nonexistent user', async () => {
    mockedGetContributions.mockRejectedValue(new AppError('User not found', 404, 'USER_NOT_FOUND'));

    const response = await request(app).get('/api/users/missinguser/contributions');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'USER_NOT_FOUND',
      },
    });
  });

  it('rejects invalid usernames before calling the service', async () => {
    const response = await request(app).get('/api/users/invalid.username/contributions');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_USERNAME');
    expect(mockedGetContributions).not.toHaveBeenCalled();
  });

  it('does not require an authorization header', async () => {
    mockedGetContributions.mockResolvedValue(buildContributions());

    const response = await request(app).get('/api/users/asil/contributions');

    expect(response.status).toBe(200);
    expect(mockedGetContributions).toHaveBeenCalledOnce();
  });

  it('propagates service errors through error middleware', async () => {
    mockedGetContributions.mockRejectedValue(
      new AppError('Contributions query failed', 503, 'CONTRIBUTIONS_QUERY_FAILED'),
    );

    const response = await request(app).get('/api/users/asil/contributions');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'CONTRIBUTIONS_QUERY_FAILED',
      },
    });
  });
});
