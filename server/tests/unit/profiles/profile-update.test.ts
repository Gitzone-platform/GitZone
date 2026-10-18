import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { updateUserProfile } from '../../../src/services/profiles/profile.service.js';
import { updateProfileSchema } from '../../../src/validations/profiles/profile.validation.js';
import { changeUsername } from '../../../src/services/profiles/username-change.service.js';
import { AppError } from '../../../src/errors/app.error.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/profiles/username-change.service.js', () => ({
  changeUsername: vi.fn(),
}));

const mockedChangeUsername = vi.mocked(changeUsername);
const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedUpdate = vi.mocked(prisma.user.update);

const publicUser = {
  id: 'user-1',
  username: 'asil',
  name: 'Asil',
  bio: 'Developer',
  avatarUrl: null,
  location: 'Uzbekistan',
  website: 'https://example.com',
  createdAt: new Date('2026-10-09T12:00:00.000Z'),
};

describe('profile update validation', () => {
  it('accepts valid profile fields', () => {
    const result = updateProfileSchema.safeParse({
      name: 'Asilbek',
      bio: 'Full Stack Developer',
      location: 'Uzbekistan',
      website: 'https://example.com',
    });

    expect(result.success).toBe(true);
  });

  it('accepts null to clear optional profile fields', () => {
    const result = updateProfileSchema.safeParse({
      name: null,
      bio: null,
      location: null,
      website: null,
    });

    expect(result.success).toBe(true);
  });

  it('rejects an empty update', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown and sensitive fields', () => {
    expect(
      updateProfileSchema.safeParse({
        name: 'Asil',
        email: 'changed@example.com',
      }).success,
    ).toBe(false);

    expect(
      updateProfileSchema.safeParse({
        isAdmin: true,
      }).success,
    ).toBe(false);
  });

  it('rejects invalid website protocols', () => {
    expect(
      updateProfileSchema.safeParse({
        website: 'http://example.com',
      }).success,
    ).toBe(false);

    expect(
      updateProfileSchema.safeParse({
        website: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
  });

  it('rejects website URLs containing credentials', () => {
    expect(
      updateProfileSchema.safeParse({
        website: 'https://user:secret@example.com',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid name and excessive text lengths', () => {
    expect(
      updateProfileSchema.safeParse({
        name: '   ',
      }).success,
    ).toBe(false);

    expect(
      updateProfileSchema.safeParse({
        bio: 'a'.repeat(501),
      }).success,
    ).toBe(false);

    expect(
      updateProfileSchema.safeParse({
        location: 'a'.repeat(101),
      }).success,
    ).toBe(false);
  });
});

describe('profile update service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('updates the authenticated user profile', async () => {
    mockedFindUnique.mockResolvedValue({ id: 'user-1' } as never);
    mockedUpdate.mockResolvedValue(publicUser as never);

    const result = await updateUserProfile('user-1', {
      name: 'Asil',
      bio: 'Developer',
    });

    expect(result).toEqual(publicUser);

    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true },
    });

    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        name: 'Asil',
        bio: 'Developer',
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

  it('delegates username and profile fields to the username change service', async () => {
    mockedFindUnique.mockResolvedValueOnce({ id: 'user-1' } as never).mockResolvedValueOnce({
      ...publicUser,
      username: 'newuser',
      name: 'New Name',
    } as never);

    const result = await updateUserProfile('user-1', {
      username: 'newuser',
      name: 'New Name',
      bio: null,
    });

    expect(mockedChangeUsername).toHaveBeenCalledOnce();
    expect(mockedChangeUsername).toHaveBeenCalledWith('user-1', 'newuser', {
      name: 'New Name',
      bio: null,
    });

    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(result.username).toBe('newuser');
    expect(result.name).toBe('New Name');
  });

  it('supports username-only profile updates', async () => {
    mockedFindUnique.mockResolvedValueOnce({ id: 'user-1' } as never).mockResolvedValueOnce({
      ...publicUser,
      username: 'newuser',
    } as never);

    const result = await updateUserProfile('user-1', {
      username: 'newuser',
    });

    expect(mockedChangeUsername).toHaveBeenCalledWith('user-1', 'newuser', {});

    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(result.username).toBe('newuser');
  });

  it('propagates username conflicts without updating other profile fields', async () => {
    mockedFindUnique.mockResolvedValueOnce({
      id: 'user-1',
    } as never);

    mockedChangeUsername.mockRejectedValueOnce(
      new AppError('Username is already taken', 409, 'USERNAME_TAKEN'),
    );

    await expect(
      updateUserProfile('user-1', {
        username: 'takenuser',
        name: 'New Name',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'USERNAME_TAKEN',
    });

    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedFindUnique).toHaveBeenCalledOnce();
  });
  it('allows clearing profile fields using null', async () => {
    mockedFindUnique.mockResolvedValue({ id: 'user-1' } as never);
    mockedUpdate.mockResolvedValue(publicUser as never);

    await updateUserProfile('user-1', {
      bio: null,
      website: null,
    });

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          bio: null,
          website: null,
        },
      }),
    );
  });

  it('does not overwrite omitted profile fields', async () => {
    mockedFindUnique.mockResolvedValue({ id: 'user-1' } as never);
    mockedUpdate.mockResolvedValue(publicUser as never);

    await updateUserProfile('user-1', {
      location: 'Bukhara',
    });

    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          location: 'Bukhara',
        },
      }),
    );
  });

  it('throws 404 when the authenticated user does not exist', async () => {
    mockedFindUnique.mockResolvedValue(null as never);

    await expect(
      updateUserProfile('missing-user', {
        name: 'Asil',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('does not expose sensitive fields in the update result', async () => {
    mockedFindUnique.mockResolvedValue({ id: 'user-1' } as never);
    mockedUpdate.mockResolvedValue(publicUser as never);

    const result = await updateUserProfile('user-1', {
      name: 'Asil',
    });

    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('updatedAt');
  });
});
