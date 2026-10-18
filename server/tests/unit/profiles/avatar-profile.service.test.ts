import { lstat, unlink } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { updateUserAvatar } from '../../../src/services/profiles/avatar-profile.service.js';
import { processAndStoreAvatar } from '../../../src/services/profiles/avatar-upload.service.js';

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn(),
  lstat: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      updateManyAndReturn: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/profiles/avatar-upload.service.js', () => ({
  processAndStoreAvatar: vi.fn(),
}));

const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedUpdate = vi.mocked(prisma.user.updateManyAndReturn);
const mockedCount = vi.mocked(prisma.user.count);
const mockedStore = vi.mocked(processAndStoreAvatar);
const mockedUnlink = vi.mocked(unlink);
const mockedLstat = vi.mocked(lstat);

const oldFilename = '123e4567-e89b-42d3-a456-426614174000.webp';
const newFilename = '123e4567-e89b-42d3-a456-426614174001.webp';

const oldAvatarUrl = `/api/users/avatars/${oldFilename}`;
const newAvatarUrl = `/api/users/avatars/${newFilename}`;

const storedAvatar = {
  filename: newFilename,
  avatarUrl: newAvatarUrl,
  absolutePath: 'mock-avatar-storage-path',
};

const publicUser = {
  id: 'user-1',
  username: 'asil',
  name: 'Asil',
  bio: 'Developer',
  avatarUrl: newAvatarUrl,
  location: 'Uzbekistan',
  website: 'https://example.com',
  createdAt: new Date('2026-10-09T12:00:00.000Z'),
};

const buffer = Buffer.from('test-image');

describe('avatar profile replacement service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedLstat.mockImplementation(async (filePath) => {
      const targetPath = String(filePath);
      const isAvatarFile = targetPath.toLowerCase().endsWith('.webp');

      return {
        isDirectory: () => !isAvatarFile,
        isFile: () => isAvatarFile,
        isSymbolicLink: () => false,
      } as Awaited<ReturnType<typeof lstat>>;
    });

    mockedFindUnique.mockResolvedValue({
      id: 'user-1',
      avatarUrl: oldAvatarUrl,
    } as never);

    mockedStore.mockResolvedValue(storedAvatar);
    mockedUpdate.mockResolvedValue([publicUser] as never);
    mockedCount.mockResolvedValue(0);
    mockedUnlink.mockResolvedValue(undefined);
  });

  it('rejects a missing user without storing an avatar', async () => {
    mockedFindUnique.mockResolvedValue(null);

    await expect(updateUserAvatar('missing-user', buffer, 'image/png')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(mockedStore).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('updates the avatar using compare-and-swap', async () => {
    const result = await updateUserAvatar('user-1', buffer, 'image/png');

    expect(result).toEqual(publicUser);

    expect(mockedUpdate).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        avatarUrl: oldAvatarUrl,
      },
      data: {
        avatarUrl: newAvatarUrl,
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

    expect(mockedFindUnique).toHaveBeenCalledOnce();
  });

  it('removes the new file when a concurrent update causes a conflict', async () => {
    mockedUpdate.mockResolvedValue([]);

    await expect(updateUserAvatar('user-1', buffer, 'image/png')).rejects.toMatchObject({
      statusCode: 409,
      code: 'AVATAR_UPDATE_CONFLICT',
    });

    expect(mockedUnlink).toHaveBeenCalledOnce();
    expect(mockedUnlink.mock.calls[0]?.[0]).toEqual(expect.stringContaining(newFilename));
  });

  it('preserves the database error after cleaning up the new file', async () => {
    const databaseError = new Error('Database unavailable');

    mockedUpdate.mockRejectedValue(databaseError);

    await expect(updateUserAvatar('user-1', buffer, 'image/png')).rejects.toBe(databaseError);

    expect(mockedUnlink).toHaveBeenCalledOnce();
  });

  it('preserves the original database error if file cleanup fails', async () => {
    const databaseError = new Error('Database unavailable');

    mockedUpdate.mockRejectedValue(databaseError);
    mockedUnlink.mockRejectedValue(new Error('File locked'));

    await expect(updateUserAvatar('user-1', buffer, 'image/png')).rejects.toBe(databaseError);
  });

  it('deletes the old avatar when it has no remaining references', async () => {
    await updateUserAvatar('user-1', buffer, 'image/png');

    expect(mockedCount).toHaveBeenCalledWith({
      where: {
        avatarUrl: oldAvatarUrl,
      },
    });

    expect(mockedUnlink).toHaveBeenCalledOnce();
    expect(mockedUnlink.mock.calls[0]?.[0]).toEqual(expect.stringContaining(oldFilename));
  });

  it('keeps an old avatar that another user still references', async () => {
    mockedCount.mockResolvedValue(1);

    await updateUserAvatar('user-1', buffer, 'image/png');

    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('rejects cleanup through a symlinked directory', async () => {
    mockedUpdate.mockResolvedValue([]);

    mockedLstat.mockImplementation(async (filePath) => {
      const targetPath = String(filePath);

      return {
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => targetPath.endsWith('avatars'),
      } as Awaited<ReturnType<typeof lstat>>;
    });

    await expect(updateUserAvatar('user-1', buffer, 'image/png')).rejects.toMatchObject({
      code: 'AVATAR_UPDATE_CONFLICT',
    });

    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('rejects cleanup when the avatar is a symlink', async () => {
    mockedUpdate.mockResolvedValue([]);

    mockedLstat.mockImplementation(async (filePath) => {
      const isAvatarFile = String(filePath).toLowerCase().endsWith('.webp');

      return {
        isDirectory: () => !isAvatarFile,
        isFile: () => isAvatarFile,
        isSymbolicLink: () => isAvatarFile,
      } as Awaited<ReturnType<typeof lstat>>;
    });

    await expect(updateUserAvatar('user-1', buffer, 'image/png')).rejects.toMatchObject({
      code: 'AVATAR_UPDATE_CONFLICT',
    });

    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('does not unlink files when the avatar directory is missing', async () => {
    mockedUpdate.mockResolvedValue([]);

    mockedLstat.mockRejectedValue(
      Object.assign(new Error('Missing directory'), {
        code: 'ENOENT',
      }),
    );

    await expect(updateUserAvatar('user-1', buffer, 'image/png')).rejects.toMatchObject({
      code: 'AVATAR_UPDATE_CONFLICT',
    });

    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('does not delete an avatar that is not a regular file', async () => {
    mockedUpdate.mockResolvedValue([]);

    mockedLstat.mockImplementation(async (filePath) => {
      const isAvatarFile = String(filePath).toLowerCase().endsWith('.webp');

      return {
        isDirectory: () => !isAvatarFile,
        isFile: () => false,
        isSymbolicLink: () => false,
      } as Awaited<ReturnType<typeof lstat>>;
    });

    await expect(updateUserAvatar('user-1', buffer, 'image/png')).rejects.toMatchObject({
      code: 'AVATAR_UPDATE_CONFLICT',
    });

    expect(mockedUnlink).not.toHaveBeenCalled();
  });
  it('returns the updated profile when old-avatar cleanup fails', async () => {
    mockedUnlink.mockRejectedValue(new Error('File locked'));

    const result = await updateUserAvatar('user-1', buffer, 'image/png');

    expect(result).toEqual(publicUser);
  });
});
