import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { updateUserAvatar } from '../../../src/services/profiles/avatar-profile.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/profiles/avatar-profile.service.js', () => ({
  updateUserAvatar: vi.fn(),
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

const mockedUpdateAvatar = vi.mocked(updateUserAvatar);

const endpoint = '/api/users/me/avatar';

const publicUser = {
  id: 'user-1',
  username: 'asil',
  name: 'Asil',
  bio: 'Developer',
  avatarUrl: '/api/users/avatars/123e4567-e89b-42d3-a456-426614174001.webp',
  location: 'Uzbekistan',
  website: 'https://example.com',
  createdAt: new Date('2026-10-09T12:00:00.000Z'),
};

const image = Buffer.from('mock-image-content');

describe('avatar upload API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedUpdateAvatar.mockResolvedValue(publicUser);
  });

  it('requires authentication before processing uploads', async () => {
    const response = await request(app).patch(endpoint).attach('avatar', image, {
      filename: 'avatar.png',
      contentType: 'image/png',
    });

    expect(response.status).toBe(401);
    expect(mockedUpdateAvatar).not.toHaveBeenCalled();
  });

  it('accepts an authenticated PNG upload', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .attach('avatar', image, {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        user: {
          id: 'user-1',
          avatarUrl: publicUser.avatarUrl,
        },
      },
    });

    expect(mockedUpdateAvatar).toHaveBeenCalledWith('user-1', image, 'image/png');
  });

  it.each([
    ['JPEG', 'avatar.jpg', 'image/jpeg'],
    ['WebP', 'avatar.webp', 'image/webp'],
  ])('accepts authenticated %s uploads', async (_label, filename, contentType) => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .attach('avatar', image, {
        filename,
        contentType,
      });

    expect(response.status).toBe(200);
    expect(mockedUpdateAvatar).toHaveBeenCalledWith('user-1', image, contentType);
  });

  it('rejects unsupported GIF uploads', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .attach('avatar', image, {
        filename: 'avatar.gif',
        contentType: 'image/gif',
      });

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('INVALID_AVATAR_TYPE');
    expect(mockedUpdateAvatar).not.toHaveBeenCalled();
  });

  it('rejects a missing avatar file', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .field('unused', 'value');

    expect(response.status).toBe(400);
    expect(mockedUpdateAvatar).not.toHaveBeenCalled();
  });

  it('rejects an unexpected multipart field name', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .attach('photo', image, {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_AVATAR_FIELD');
    expect(mockedUpdateAvatar).not.toHaveBeenCalled();
  });

  it('rejects files larger than 5 MB', async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .attach('avatar', oversized, {
        filename: 'large.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('AVATAR_TOO_LARGE');
    expect(mockedUpdateAvatar).not.toHaveBeenCalled();
  });

  it('returns service errors through the API error handler', async () => {
    mockedUpdateAvatar.mockRejectedValue(
      new AppError('Avatar was changed by another request', 409, 'AVATAR_UPDATE_CONFLICT'),
    );

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer valid-test-token')
      .attach('avatar', image, {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('AVATAR_UPDATE_CONFLICT');
  });
});
