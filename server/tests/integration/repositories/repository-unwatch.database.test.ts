import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import {
  unwatchRepository,
  watchRepository,
} from '../../../src/services/repositories/repository-watch.service.js';

const runDatabaseTests = process.env.RUN_UNWATCH_DATABASE_TEST === '1';

describe.skipIf(!runDatabaseTests)('repository unwatch real PostgreSQL integration', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);

  const ownerUsername = `unwatch_owner_${suffix}`;
  const viewerUsername = `unwatch_viewer_${suffix}`;
  const secondViewerUsername = `unwatch_other_${suffix}`;
  const collaboratorUsername = `unwatch_collab_${suffix}`;

  const publicName = `unwatch_public_${suffix}`;
  const privateName = `unwatch_private_${suffix}`;

  const createdUserIds: string[] = [];
  const createdRepositoryIds: string[] = [];

  let ownerId = '';
  let viewerId = '';
  let secondViewerId = '';
  let collaboratorId = '';

  let publicRepositoryId = '';
  let privateRepositoryId = '';

  beforeAll(async () => {
    for (const username of [
      ownerUsername,
      viewerUsername,
      secondViewerUsername,
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

    const [
      createdOwnerId,
      createdViewerId,
      createdSecondViewerId,
      createdCollaboratorId,
    ] = createdUserIds;

    if (
      !createdOwnerId ||
      !createdViewerId ||
      !createdSecondViewerId ||
      !createdCollaboratorId
    ) {
      throw new Error('User fixtures were not initialized');
    }

    ownerId = createdOwnerId;
    viewerId = createdViewerId;
    secondViewerId = createdSecondViewerId;
    collaboratorId = createdCollaboratorId;

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

    const [createdPublicId, createdPrivateId] = createdRepositoryIds;

    if (!createdPublicId || !createdPrivateId) {
      throw new Error('Repository fixtures were not initialized');
    }

    publicRepositoryId = createdPublicId;
    privateRepositoryId = createdPrivateId;

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

  it('removes an existing watch on a public repository', async () => {
    await watchRepository(viewerId, ownerUsername, publicName);

    const result = await unwatchRepository(
      viewerId,
      ownerUsername,
      publicName,
    );

    expect(result).toEqual({
      repositoryId: publicRepositoryId,
      watching: false,
    });

    const count = await prisma.repositoryWatch.count({
      where: {
        userId: viewerId,
        repositoryId: publicRepositoryId,
      },
    });

    expect(count).toBe(0);
  });

  it('is idempotent when a repository is already unwatched', async () => {
    const first = await unwatchRepository(
      viewerId,
      ownerUsername,
      publicName,
    );

    const second = await unwatchRepository(
      viewerId,
      ownerUsername,
      publicName,
    );

    expect(second).toEqual(first);
    expect(first.watching).toBe(false);

    const count = await prisma.repositoryWatch.count({
      where: {
        userId: viewerId,
        repositoryId: publicRepositoryId,
      },
    });

    expect(count).toBe(0);
  });

  it('does not remove another user watch', async () => {
    await watchRepository(viewerId, ownerUsername, publicName);
    await watchRepository(secondViewerId, ownerUsername, publicName);

    await unwatchRepository(viewerId, ownerUsername, publicName);

    const viewerCount = await prisma.repositoryWatch.count({
      where: {
        userId: viewerId,
        repositoryId: publicRepositoryId,
      },
    });

    const otherCount = await prisma.repositoryWatch.count({
      where: {
        userId: secondViewerId,
        repositoryId: publicRepositoryId,
      },
    });

    expect(viewerCount).toBe(0);
    expect(otherCount).toBe(1);
  });

  it('allows the owner to unwatch a private repository', async () => {
    await watchRepository(ownerId, ownerUsername, privateName);

    const result = await unwatchRepository(
      ownerId,
      ownerUsername,
      privateName,
    );

    expect(result).toEqual({
      repositoryId: privateRepositoryId,
      watching: false,
    });

    const count = await prisma.repositoryWatch.count({
      where: {
        userId: ownerId,
        repositoryId: privateRepositoryId,
      },
    });

    expect(count).toBe(0);
  });

  it('allows a READ collaborator to unwatch a private repository', async () => {
    await watchRepository(collaboratorId, ownerUsername, privateName);

    const result = await unwatchRepository(
      collaboratorId,
      ownerUsername,
      privateName,
    );

    expect(result).toEqual({
      repositoryId: privateRepositoryId,
      watching: false,
    });

    const count = await prisma.repositoryWatch.count({
      where: {
        userId: collaboratorId,
        repositoryId: privateRepositoryId,
      },
    });

    expect(count).toBe(0);
  });

  it('denies unwatch for an inaccessible private repository', async () => {
    await expect(
      unwatchRepository(viewerId, ownerUsername, privateName),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    const count = await prisma.repositoryWatch.count({
      where: {
        userId: viewerId,
        repositoryId: privateRepositoryId,
      },
    });

    expect(count).toBe(0);
  });

  it('returns 404 when the repository does not exist', async () => {
    await expect(
      unwatchRepository(viewerId, ownerUsername, `missing_${suffix}`),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });
  });
});
