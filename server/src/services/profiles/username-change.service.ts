import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { renameGitUserDirectory } from '../git/git-user-directory.service.js';
import { withGitUserWriteLock } from '../git/git-user-lock.service.js';
import {
  profileUsernameSchema,
  type UpdateProfileInput,
} from '../../validations/profiles/profile.validation.js';

type UsernameProfileFields = Omit<UpdateProfileInput, 'username'>;

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

export const changeUsername = async (
  userId: string,
  newUsername: string,
  profileFields: UsernameProfileFields = {},
): Promise<void> =>
  withGitUserWriteLock(userId, async () => {
    if (!profileUsernameSchema.safeParse(newUsername).success) {
      throw new AppError('Invalid username', 400, 'INVALID_USERNAME');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });

    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const oldUsername = user.username;

    if (oldUsername === newUsername) {
      if (Object.keys(profileFields).length > 0) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            ...(profileFields.name !== undefined ? { name: profileFields.name } : {}),
            ...(profileFields.bio !== undefined ? { bio: profileFields.bio } : {}),
            ...(profileFields.location !== undefined ? { location: profileFields.location } : {}),
            ...(profileFields.website !== undefined ? { website: profileFields.website } : {}),
          },
          select: { id: true },
        });
      }

      return;
    }

    if (oldUsername.toLowerCase() === newUsername.toLowerCase()) {
      throw new AppError(
        'Case-only username changes are not supported',
        409,
        'USERNAME_CASE_CONFLICT',
      );
    }

    const existing = await prisma.user.findFirst({
      where: {
        username: {
          equals: newUsername,
          mode: 'insensitive',
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new AppError('Username is already taken', 409, 'USERNAME_TAKEN');
    }

    const reservedName = await prisma.namespaceEntry.findUnique({
      where: { name: newUsername.toLowerCase() },
      select: { name: true },
    });

    if (reservedName) {
      throw new AppError('Username is already taken', 409, 'USERNAME_TAKEN');
    }

    const directoryMoved = await renameGitUserDirectory(oldUsername, newUsername);

    if (!directoryMoved) {
      const repositoryCount = await prisma.repository.count({
        where: { ownerId: userId },
      });

      if (repositoryCount > 0) {
        throw new AppError(
          'Git user directory is missing for existing repositories',
          409,
          'GIT_USER_DIRECTORY_MISSING',
        );
      }
    }

    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          username: newUsername,
          ...(profileFields.name !== undefined ? { name: profileFields.name } : {}),
          ...(profileFields.bio !== undefined ? { bio: profileFields.bio } : {}),
          ...(profileFields.location !== undefined ? { location: profileFields.location } : {}),
          ...(profileFields.website !== undefined ? { website: profileFields.website } : {}),
        },
        select: { id: true },
      });
    } catch (error) {
      if (directoryMoved) {
        try {
          const restored = await renameGitUserDirectory(newUsername, oldUsername);

          if (!restored) {
            throw new Error('Git directory rollback did not restore the source', { cause: error });
          }
        } catch (rollbackError) {
          const failure = new AppError(
            'Username update failed and Git directory rollback failed',
            500,
            'USERNAME_ROLLBACK_FAILED',
            { cause: rollbackError },
          );

          Object.assign(failure, { databaseError: error });

          throw failure;
        }
      }

      if (isUniqueConstraintError(error)) {
        throw new AppError('Username is already taken', 409, 'USERNAME_TAKEN');
      }

      throw error;
    }
  });
