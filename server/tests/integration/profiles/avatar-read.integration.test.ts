import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { readStoredAvatar } from '../../../src/services/profiles/avatar-read.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/profiles/avatar-read.service.js', () => ({
  readStoredAvatar: vi.fn(),
}));

const mockedReadAvatar = vi.mocked(readStoredAvatar);

const filename = '123e4567-e89b-42d3-a456-426614174000.webp';
const endpoint = `/api/users/avatars/${filename}`;

const image = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe('avatar read API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedReadAvatar.mockResolvedValue(image);
  });

  it('serves avatar images without authentication', async () => {
    const response = await request(app).get(endpoint);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(image);
    expect(mockedReadAvatar).toHaveBeenCalledWith(filename);
  });

  it('returns the WebP content type', async () => {
    const response = await request(app).get(endpoint);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^image\/webp/);
  });

  it('sets nosniff to prevent content-type sniffing', async () => {
    const response = await request(app).get(endpoint);

    expect(response.status).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets immutable public cache headers', async () => {
    const response = await request(app).get(endpoint);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('public');
    expect(response.headers['cache-control']).toContain('max-age=86400');
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('returns the correct content length', async () => {
    const response = await request(app).get(endpoint);

    expect(response.status).toBe(200);
    expect(Number(response.headers['content-length'])).toBe(image.length);
  });

  it('rejects invalid avatar filenames', async () => {
    mockedReadAvatar.mockRejectedValue(
      new AppError('Invalid avatar filename', 400, 'INVALID_AVATAR_FILENAME'),
    );

    const response = await request(app).get('/api/users/avatars/not-a-uuid.webp');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_AVATAR_FILENAME');
  });

  it('returns 404 for a missing avatar', async () => {
    mockedReadAvatar.mockRejectedValue(new AppError('Avatar not found', 404, 'AVATAR_NOT_FOUND'));

    const response = await request(app).get(endpoint);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('AVATAR_NOT_FOUND');
  });

  it('returns a controlled error for unsafe storage', async () => {
    mockedReadAvatar.mockRejectedValue(
      new AppError('Unsafe avatar storage directory', 500, 'AVATAR_STORAGE_UNSAFE'),
    );

    const response = await request(app).get(endpoint);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(mockedReadAvatar).toHaveBeenCalledWith(filename);
  });

  it('does not expose filesystem paths in missing-file errors', async () => {
    mockedReadAvatar.mockRejectedValue(new AppError('Avatar not found', 404, 'AVATAR_NOT_FOUND'));

    const response = await request(app).get(endpoint);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('storage\\avatars');
    expect(JSON.stringify(response.body)).not.toContain('storage/avatars');
  });
});
