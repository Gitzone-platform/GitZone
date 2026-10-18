import { lstat, unlink } from 'node:fs/promises';
import path from 'node:path';

import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import type { PublicUserProfile } from '../../types/profile.types.js';
import { processAndStoreAvatar } from './avatar-upload.service.js';

const LOCAL_AVATAR_PATTERN =
  /^\/api\/users\/avatars\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp)$/i;

const getLocalAvatarPath = (avatarUrl: string | null): string | null => {
  if (!avatarUrl) {
    return null;
  }

  const match = LOCAL_AVATAR_PATTERN.exec(avatarUrl);

  if (!match?.[1]) {
    return null;
  }

  return path.resolve(process.cwd(), 'storage', 'avatars', match[1]);
};

const removeLocalAvatar = async (avatarUrl: string | null): Promise<void> => {
  const avatarPath = getLocalAvatarPath(avatarUrl);

  if (!avatarPath) {
    return;
  }

  // Never delete files through an untrusted storage directory.
  const directory = path.dirname(avatarPath);
  const parsed = path.parse(directory);
  const segments = path.relative(parsed.root, directory).split(path.sep).filter(Boolean);

  let current = parsed.root;

  for (const segment of segments) {
    current = path.join(current, segment);

    let stats;

    try {
      stats = await lstat(current);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return;
      }

      throw error;
    }

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new AppError('Unsafe avatar storage directory', 500, 'AVATAR_STORAGE_UNSAFE');
    }
  }

  try {
    const entry = await lstat(avatarPath);

    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new AppError('Unsafe avatar file', 500, 'AVATAR_FILE_UNSAFE');
    }

    await unlink(avatarPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
};

export const updateUserAvatar = async (
  userId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<PublicUserProfile> => {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      avatarUrl: true,
    },
  });

  if (!existingUser) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const storedAvatar = await processAndStoreAvatar(buffer, mimeType);

  let updatedUser: PublicUserProfile;

  try {
    const updatedUsers = await prisma.user.updateManyAndReturn({
      where: {
        id: userId,
        avatarUrl: existingUser.avatarUrl,
      },
      data: {
        avatarUrl: storedAvatar.avatarUrl,
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

    if (updatedUsers.length !== 1 || !updatedUsers[0]) {
      throw new AppError(
        'Avatar was changed by another request. Please retry.',
        409,
        'AVATAR_UPDATE_CONFLICT',
      );
    }

    updatedUser = updatedUsers[0];
  } catch (error) {
    try {
      await removeLocalAvatar(storedAvatar.avatarUrl);
    } catch {
      // Preserve the original database error.
      // Orphaned files require maintenance cleanup.
    }

    throw error;
  }
  if (existingUser.avatarUrl && existingUser.avatarUrl !== storedAvatar.avatarUrl) {
    try {
      const references = await prisma.user.count({
        where: {
          avatarUrl: existingUser.avatarUrl,
        },
      });

      if (references === 0) {
        await removeLocalAvatar(existingUser.avatarUrl);
      }
    } catch {
      // The avatar update succeeded.
      // Failed cleanup can be retried by a maintenance task.
    }
  }

  return updatedUser;
};
