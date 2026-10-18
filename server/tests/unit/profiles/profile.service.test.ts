import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { getPublicUserProfile } from '../../../src/services/profiles/profile.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

const mockedUserFindUnique = vi.mocked(prisma.user.findUnique);

const createdAt = new Date('2026-10-09T12:00:00.000Z');

const publicUser = {
  id: 'user-1',
  username: 'asil',
  name: 'Asil',
  bio: 'Full Stack Developer',
  avatarUrl: null,
  location: 'Uzbekistan',
  website: 'https://example.com',
  createdAt,
};

describe('public user profile service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns an existing public user profile', async () => {
    mockedUserFindUnique.mockResolvedValue(publicUser as never);

    const result = await getPublicUserProfile('asil');

    expect(result).toEqual(publicUser);
    expect(result.username).toBe('asil');
    expect(result.location).toBe('Uzbekistan');
    expect(result.website).toBe('https://example.com');
  });

  it('selects only approved public profile fields', async () => {
    mockedUserFindUnique.mockResolvedValue(publicUser as never);

    await getPublicUserProfile('asil');

    expect(mockedUserFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: {
        username: 'asil',
      },
      select: {
        id: true,
        username: true,
        name: true,
        bio: true,
        avatarUrl: true,
        location: true,
        website: true,
        createdAt: true,
      },
    });
  });

  it('does not expose email or password in public profile', async () => {
    mockedUserFindUnique.mockResolvedValue(publicUser as never);

    const result = await getPublicUserProfile('asil');

    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('throws 404 when user does not exist', async () => {
    mockedUserFindUnique.mockResolvedValue(null as never);

    await expect(getPublicUserProfile('unknownuser')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
  });
});
