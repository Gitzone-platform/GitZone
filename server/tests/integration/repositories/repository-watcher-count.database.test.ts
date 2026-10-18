import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import {
  getRepositoryWatcherCount,
  unwatchRepository,
  updateRepositoryWatchPreference,
  watchRepository,
} from '../../../src/services/repositories/repository-watch.service.js';

const enabled = process.env.RUN_WATCHER_COUNT_DATABASE_TEST === '1';

describe.skipIf(!enabled)('repository watcher count real PostgreSQL integration', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);

  const ownerUsername = `count_owner_${suffix}`;
  const viewerUsername = `count_viewer_${suffix}`;
  const otherUsername = `count_other_${suffix}`;
  const collaboratorUsername = `count_collab_${suffix}`;

  const publicName = `count_public_${suffix}`;
  const privateName = `count_private_${suffix}`;

  const createdUserIds: string[] = [];
  const createdRepositoryIds: string[] = [];

  let ownerId = '';
  let viewerId = '';
  let otherId = '';
  let collaboratorId = '';
  let publicRepositoryId = '';
  let privateRepositoryId = '';

  beforeAll(async () => {
    for (const username of [ownerUsername, viewerUsername, otherUsername, collaboratorUsername]) {
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

  it('starts with zero watchers', async () => {
    const result = await getRepositoryWatcherCount(ownerUsername, publicName);

    expect(result).toEqual({
      repositoryId: publicRepositoryId,
      watcherCount: 0,
    });
  });

  it('counts distinct users watching the repository', async () => {
    await watchRepository(viewerId, ownerUsername, publicName);
    await watchRepository(otherId, ownerUsername, publicName);
    await watchRepository(viewerId, ownerUsername, publicName);

    const result = await getRepositoryWatcherCount(ownerUsername, publicName);

    expect(result.watcherCount).toBe(2);
  });

  it('includes IGNORE and PARTICIPATING preferences', async () => {
    await updateRepositoryWatchPreference(viewerId, ownerUsername, publicName, 'IGNORE');

    await updateRepositoryWatchPreference(otherId, ownerUsername, publicName, 'PARTICIPATING');

    const result = await getRepositoryWatcherCount(ownerUsername, publicName);

    expect(result.watcherCount).toBe(2);
  });

  it('decreases after unwatch', async () => {
    await unwatchRepository(viewerId, ownerUsername, publicName);

    const result = await getRepositoryWatcherCount(ownerUsername, publicName);

    expect(result.watcherCount).toBe(1);
  });

  it('allows the owner to count private watchers', async () => {
    await watchRepository(ownerId, ownerUsername, privateName);

    const result = await getRepositoryWatcherCount(ownerUsername, privateName, ownerId);

    expect(result).toEqual({
      repositoryId: privateRepositoryId,
      watcherCount: 1,
    });
  });

  it('allows READ collaborators to count private watchers', async () => {
    await watchRepository(collaboratorId, ownerUsername, privateName);

    const result = await getRepositoryWatcherCount(ownerUsername, privateName, collaboratorId);

    expect(result.watcherCount).toBe(2);
  });

  it('denies anonymous access to private watcher counts', async () => {
    await expect(getRepositoryWatcherCount(ownerUsername, privateName)).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });
  });

  it('denies unauthorized viewers access to private counts', async () => {
    await expect(
      getRepositoryWatcherCount(ownerUsername, privateName, viewerId),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });
  });

  it('returns 404 for missing repositories', async () => {
    await expect(
      getRepositoryWatcherCount(ownerUsername, `missing_${suffix}`),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });
  });
});
