import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { getPublicUserProfile } from '../../../src/services/profiles/profile.service.js';
import { getUserRepositories } from '../../../src/services/repositories/repository.service.js';

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

const mockedGetProfile = vi.mocked(getPublicUserProfile);
const mockedGetRepositories = vi.mocked(getUserRepositories);

const publicUser = {
  id: 'user-1',
  username: 'asil',
  name: 'Asilbek',
  bio: 'Developer',
  avatarUrl: null,
  location: 'Uzbekistan',
  website: 'https://example.com',
  createdAt: new Date('2026-10-09T12:00:00.000Z'),
};

const publicRepository = {
  id: 'repo-1',
  ownerId: 'user-1',
  name: 'gitzone',
  description: 'Git hosting platform',
  isPrivate: false,
  defaultBranch: 'main',
  createdAt: new Date('2026-10-09T12:00:00.000Z'),
  updatedAt: new Date('2026-10-09T12:00:00.000Z'),
};

describe('public profile repositories API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedGetProfile.mockResolvedValue(publicUser);
  });

  it('returns public repositories for an existing user', async () => {
    mockedGetRepositories.mockResolvedValue([publicRepository]);

    const response = await request(app).get('/api/users/asil/repositories');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.repositories).toHaveLength(1);
    expect(response.body.data.repositories[0]).toMatchObject({
      id: 'repo-1',
      name: 'gitzone',
      isPrivate: false,
    });

    expect(mockedGetProfile).toHaveBeenCalledWith('asil');
    expect(mockedGetRepositories).toHaveBeenCalledWith('asil');
  });

  it('returns an empty list for a user without public repositories', async () => {
    mockedGetRepositories.mockResolvedValue([]);

    const response = await request(app).get('/api/users/asil/repositories');

    expect(response.status).toBe(200);
    expect(response.body.data.repositories).toEqual([]);
  });

  it('returns 404 for a nonexistent user', async () => {
    mockedGetProfile.mockRejectedValue(new AppError('User not found', 404, 'USER_NOT_FOUND'));

    const response = await request(app).get('/api/users/missinguser/repositories');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('USER_NOT_FOUND');
    expect(mockedGetRepositories).not.toHaveBeenCalled();
  });

  it('rejects invalid usernames', async () => {
    const response = await request(app).get('/api/users/invalid.username/repositories');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_USERNAME');
    expect(mockedGetProfile).not.toHaveBeenCalled();
    expect(mockedGetRepositories).not.toHaveBeenCalled();
  });

  it('does not require an authorization header', async () => {
    mockedGetRepositories.mockResolvedValue([publicRepository]);

    const response = await request(app).get('/api/users/asil/repositories');

    expect(response.status).toBe(200);
    expect(mockedGetRepositories).toHaveBeenCalledOnce();
  });

  it('propagates repository service errors through error middleware', async () => {
    mockedGetRepositories.mockRejectedValue(
      new AppError('Repository query failed', 503, 'REPOSITORY_QUERY_FAILED'),
    );

    const response = await request(app).get('/api/users/asil/repositories');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('REPOSITORY_QUERY_FAILED');
  });
});
