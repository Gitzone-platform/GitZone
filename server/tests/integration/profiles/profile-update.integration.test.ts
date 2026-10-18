import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { updateUserProfile } from '../../../src/services/profiles/profile.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/profiles/profile.service.js', () => ({
  getPublicUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock('../../../src/middleware/auth.middleware.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization !== 'Bearer valid-test-token') {
      throw new AppError('Authorization required', 401, 'AUTHORIZATION_REQUIRED');
    }

    (req as Request & { userId: string }).userId = 'user-1';
    next();
  },
}));

const mockedUpdateUserProfile = vi.mocked(updateUserProfile);

const publicUser = {
  id: 'user-1',
  username: 'asil',
  name: 'Asilbek',
  bio: 'Full Stack Developer',
  avatarUrl: null,
  location: 'Uzbekistan',
  website: 'https://example.com',
  createdAt: new Date('2026-10-09T12:00:00.000Z'),
};

const endpoint = '/api/users/me';

describe('profile update API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('updates profile with valid authentication and data', async () => {
    mockedUpdateUserProfile.mockResolvedValue(publicUser);

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        name: 'Asilbek',
        bio: 'Full Stack Developer',
      });

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        user: {
          id: 'user-1',
          username: 'asil',
          name: 'Asilbek',
          bio: 'Full Stack Developer',
        },
      },
    });

    expect(mockedUpdateUserProfile).toHaveBeenCalledWith('user-1', {
      name: 'Asilbek',
      bio: 'Full Stack Developer',
    });
  });

  it('updates username successfully', async () => {
    mockedUpdateUserProfile.mockResolvedValue({
      ...publicUser,
      username: 'newuser',
    });

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({ username: 'newuser' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        user: {
          id: 'user-1',
          username: 'newuser',
        },
      },
    });

    expect(mockedUpdateUserProfile).toHaveBeenCalledWith('user-1', { username: 'newuser' });
  });

  it('updates username and other profile fields together', async () => {
    mockedUpdateUserProfile.mockResolvedValue({
      ...publicUser,
      username: 'newuser',
      name: 'Updated Name',
      bio: null,
    });

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        username: 'newuser',
        name: 'Updated Name',
        bio: null,
      });

    expect(response.status).toBe(200);

    expect(response.body.data.user).toMatchObject({
      username: 'newuser',
      name: 'Updated Name',
      bio: null,
    });

    expect(mockedUpdateUserProfile).toHaveBeenCalledWith('user-1', {
      username: 'newuser',
      name: 'Updated Name',
      bio: null,
    });
  });

  it('returns 409 when username is already taken', async () => {
    mockedUpdateUserProfile.mockRejectedValue(
      new AppError('Username is already taken', 409, 'USERNAME_TAKEN'),
    );

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        username: 'takenuser',
        name: 'Updated Name',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('USERNAME_TAKEN');

    expect(mockedUpdateUserProfile).toHaveBeenCalledOnce();
  });

  it('rejects invalid username formats before calling the service', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        username: 'invalid username!',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PROFILE_DATA');

    expect(mockedUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('returns 409 when Git storage is missing for existing repositories', async () => {
    mockedUpdateUserProfile.mockRejectedValue(
      new AppError(
        'Git user directory is missing for existing repositories',
        409,
        'GIT_USER_DIRECTORY_MISSING',
      ),
    );

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({ username: 'newuser' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('GIT_USER_DIRECTORY_MISSING');
  });

  it('accepts an unchanged username with updated profile fields', async () => {
    mockedUpdateUserProfile.mockResolvedValue({
      ...publicUser,
      name: 'Updated Name',
    });

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        username: 'asil',
        name: 'Updated Name',
      });

    expect(response.status).toBe(200);

    expect(response.body.data.user).toMatchObject({
      username: 'asil',
      name: 'Updated Name',
    });

    expect(mockedUpdateUserProfile).toHaveBeenCalledWith('user-1', {
      username: 'asil',
      name: 'Updated Name',
    });
  });
  it('rejects requests without authorization', async () => {
    const response = await request(app).patch(endpoint).send({ name: 'Asilbek' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHORIZATION_REQUIRED');
    expect(mockedUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects invalid authentication tokens', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer invalid-token')
      .send({ name: 'Asilbek' });

    expect(response.status).toBe(401);
    expect(mockedUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects empty update requests', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PROFILE_DATA');
    expect(mockedUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects attempts to update sensitive fields', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        name: 'Asilbek',
        email: 'changed@example.com',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PROFILE_DATA');
    expect(mockedUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('rejects insecure website URLs', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        website: 'http://example.com',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PROFILE_DATA');
    expect(mockedUpdateUserProfile).not.toHaveBeenCalled();
  });

  it('supports clearing profile fields', async () => {
    mockedUpdateUserProfile.mockResolvedValue({
      ...publicUser,
      bio: null,
      website: null,
    });

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        bio: null,
        website: null,
      });

    expect(response.status).toBe(200);

    expect(mockedUpdateUserProfile).toHaveBeenCalledWith('user-1', {
      bio: null,
      website: null,
    });
  });

  it('returns 404 when the authenticated user no longer exists', async () => {
    mockedUpdateUserProfile.mockRejectedValue(
      new AppError('User not found', 404, 'USER_NOT_FOUND'),
    );

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .send({ name: 'Asilbek' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('USER_NOT_FOUND');
  });
});
