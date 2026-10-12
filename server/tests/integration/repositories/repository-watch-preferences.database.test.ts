import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import {
  unwatchRepository,
  updateRepositoryWatchPreference,
  watchRepository,
} from '../../../src/services/repositories/repository-watch.service.js';

const runDatabaseTests = process.env.RUN_WATCH_PREFERENCES_DATABASE_TEST === '1';

describe.skipIf(!runDatabaseTests)(
  'repository watch preferences real PostgreSQL integration',
  () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);

    const ownerUsername = `pref_owner_${suffix}`;
    const viewerUsername = `pref_viewer_${suffix}`;
    const otherUsername = `pref_other_${suffix}`;
    const collaboratorUsername = `pref_collab_${suffix}`;

    const publicName = `pref_public_${suffix}`;
    const privateName = `pref_private_${suffix}`;

    const createdUserIds: string[] = [];
    const createdRepositoryIds: string[] = [];

    let ownerId = '';
    let viewerId = '';
    let otherId = '';
    let collaboratorId = '';
    let publicRepositoryId = '';
    let privateRepositoryId = '';

    beforeAll(async () => {
      for (const username of [
        ownerUsername,
        viewerUsername,
        otherUsername,
        collaboratorUsername,
      ]) {
        const user = await prisma.user.create({
          data: {
            username,
            email: `${username}@example.invalid`,
            password: 'temporary-test-password-not-for-login',
          },
          select: { id: true },
        });

        createdUserIds.push(user.id);
      }

      const [owner, viewer, other, collaborator] = createdUserIds;

      if (!owner || !viewer || !other || !collaborator) {
        throw new Error('User fixtures were not initialized');
      }

      ownerId = owner;
      viewerId = viewer;
      otherId = other;
      collaboratorId = collaborator;

      for (const item of [
        { name: publicName, isPrivate: false },
        { name: privateName, isPrivate: true },
      ]) {
        const repository = await prisma.repository.create({
          data: {
            ownerId,
            name: item.name,
            isPrivate: item.isPrivate,
          },
          select: { id: true },
        });

        createdRepositoryIds.push(repository.id);
      }

      const [publicId, privateId] = createdRepositoryIds;

      if (!publicId || !privateId) {
        throw new Error('Repository fixtures were not initialized');
      }

      publicRepositoryId = publicId;
      privateRepositoryId = privateId;

      await prisma.repositoryCollaborator.create({
        data: {
          repositoryId: privateRepositoryId,
          userId: collaboratorId,
          permission: 'READ',
        },
      });
    });

    afterAll(async () => {
      try {
        if (createdRepositoryIds.length > 0) {
          await prisma.repositoryWatch.deleteMany({
            where: {
              repositoryId: { in: createdRepositoryIds },
            },
          });

          await prisma.repositoryCollaborator.deleteMany({
            where: {
              repositoryId: { in: createdRepositoryIds },
            },
          });

          await prisma.repository.deleteMany({
            where: {
              id: { in: createdRepositoryIds },
            },
          });
        }

        if (createdUserIds.length > 0) {
          await prisma.user.deleteMany({
            where: {
              id: { in: createdUserIds },
            },
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    });

    it('defaults a new watch to ALL', async () => {
      await watchRepository(viewerId, ownerUsername, publicName);

      const watch = await prisma.repositoryWatch.findUniqueOrThrow({
        where: {
          userId_repositoryId: {
            userId: viewerId,
            repositoryId: publicRepositoryId,
          },
        },
      });

      expect(watch.preference).toBe('ALL');
    });

    it.each(['PARTICIPATING', 'IGNORE', 'ALL'] as const)(
      'persists preference %s',
      async (preference) => {
        const result = await updateRepositoryWatchPreference(
          viewerId,
          ownerUsername,
          publicName,
          preference,
        );

        expect(result).toEqual({
          repositoryId: publicRepositoryId,
          watching: true,
          preference,
        });

        const watch = await prisma.repositoryWatch.findUniqueOrThrow({
          where: {
            userId_repositoryId: {
              userId: viewerId,
              repositoryId: publicRepositoryId,
            },
          },
        });

        expect(watch.preference).toBe(preference);
      },
    );

    it('does not change another user preference', async () => {
      await watchRepository(otherId, ownerUsername, publicName);

      await updateRepositoryWatchPreference(
        viewerId,
        ownerUsername,
        publicName,
        'IGNORE',
      );

      const otherWatch = await prisma.repositoryWatch.findUniqueOrThrow({
        where: {
          userId_repositoryId: {
            userId: otherId,
            repositoryId: publicRepositoryId,
          },
        },
      });

      expect(otherWatch.preference).toBe('ALL');
    });

    it('preserves the existing watch and createdAt', async () => {
      const before = await prisma.repositoryWatch.findUniqueOrThrow({
        where: {
          userId_repositoryId: {
            userId: viewerId,
            repositoryId: publicRepositoryId,
          },
        },
      });

      await updateRepositoryWatchPreference(
        viewerId,
        ownerUsername,
        publicName,
        'PARTICIPATING',
      );

      const after = await prisma.repositoryWatch.findUniqueOrThrow({
        where: {
          userId_repositoryId: {
            userId: viewerId,
            repositoryId: publicRepositoryId,
          },
        },
      });

      expect(after.id).toBe(before.id);
      expect(after.createdAt).toEqual(before.createdAt);
      expect(after.preference).toBe('PARTICIPATING');
    });

    it('returns WATCH_NOT_FOUND without creating a watch', async () => {
      await expect(
        updateRepositoryWatchPreference(
          otherId,
          ownerUsername,
          privateName,
          'IGNORE',
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'REPOSITORY_ACCESS_DENIED',
      });

      await unwatchRepository(otherId, ownerUsername, publicName);

      await expect(
        updateRepositoryWatchPreference(
          otherId,
          ownerUsername,
          publicName,
          'IGNORE',
        ),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'WATCH_NOT_FOUND',
      });

      expect(
        await prisma.repositoryWatch.count({
          where: {
            userId: otherId,
            repositoryId: publicRepositoryId,
          },
        }),
      ).toBe(0);
    });

    it('allows the owner to update a private repository watch', async () => {
      await watchRepository(ownerId, ownerUsername, privateName);

      const result = await updateRepositoryWatchPreference(
        ownerId,
        ownerUsername,
        privateName,
        'IGNORE',
      );

      expect(result.preference).toBe('IGNORE');
    });

    it('allows a READ collaborator to update a private watch', async () => {
      await watchRepository(collaboratorId, ownerUsername, privateName);

      const result = await updateRepositoryWatchPreference(
        collaboratorId,
        ownerUsername,
        privateName,
        'PARTICIPATING',
      );

      expect(result.preference).toBe('PARTICIPATING');
    });

    it('denies inaccessible private repository preferences', async () => {
      await expect(
        updateRepositoryWatchPreference(
          viewerId,
          ownerUsername,
          privateName,
          'IGNORE',
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'REPOSITORY_ACCESS_DENIED',
      });
    });

    it('returns 404 for a missing repository', async () => {
      await expect(
        updateRepositoryWatchPreference(
          viewerId,
          ownerUsername,
          `missing_${suffix}`,
          'ALL',
        ),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'REPOSITORY_NOT_FOUND',
      });
    });

    it('unwatch removes the preference row', async () => {
      await unwatchRepository(viewerId, ownerUsername, publicName);

      expect(
        await prisma.repositoryWatch.count({
          where: {
            userId: viewerId,
            repositoryId: publicRepositoryId,
          },
        }),
      ).toBe(0);
    });
  },
);
