import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { watchRepository } from '../../../src/services/repositories/repository-watch.service.js';

const runDatabaseTests = process.env.RUN_WATCH_DATABASE_TEST === '1';

describe.skipIf(!runDatabaseTests)('repository watch real PostgreSQL integration', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);

  const ownerUsername = `watch_owner_${suffix}`;
  const viewerUsername = `watch_viewer_${suffix}`;
  const collaboratorUsername = `watch_collab_${suffix}`;

  const publicName = `watch_public_${suffix}`;
  const privateName = `watch_private_${suffix}`;
  const cascadeName = `watch_cascade_${suffix}`;

  const createdUserIds: string[] = [];
  const createdRepositoryIds: string[] = [];

  let ownerId = '';
  let viewerId = '';
  let collaboratorId = '';

  let publicRepositoryId = '';
  let privateRepositoryId = '';
  let cascadeRepositoryId = '';

  beforeAll(async () => {
    for (const username of [ownerUsername, viewerUsername, collaboratorUsername]) {
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

    const [createdOwnerId, createdViewerId, createdCollaboratorId] = createdUserIds;

    if (!createdOwnerId || !createdViewerId || !createdCollaboratorId) {
      throw new Error('User fixtures were not initialized');
    }

    ownerId = createdOwnerId;
    viewerId = createdViewerId;
    collaboratorId = createdCollaboratorId;

    for (const item of [
      { name: publicName, isPrivate: false },
      { name: privateName, isPrivate: true },
      { name: cascadeName, isPrivate: false },
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

    const [createdPublicId, createdPrivateId, createdCascadeId] = createdRepositoryIds;

    if (!createdPublicId || !createdPrivateId || !createdCascadeId) {
      throw new Error('Repository fixtures were not initialized');
    }

    publicRepositoryId = createdPublicId;
    privateRepositoryId = createdPrivateId;
    cascadeRepositoryId = createdCascadeId;

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

  it('persists a watch on a public repository', async () => {
    const result = await watchRepository(viewerId, ownerUsername, publicName);

    expect(result).toEqual({
      repositoryId: publicRepositoryId,
      watching: true,
    });

    const count = await prisma.repositoryWatch.count({
      where: {
        userId: viewerId,
        repositoryId: publicRepositoryId,
      },
    });

    expect(count).toBe(1);
  });

  it('keeps exactly one watch after repeated requests', async () => {
    const first = await watchRepository(viewerId, ownerUsername, publicName);

    const second = await watchRepository(viewerId, ownerUsername, publicName);

    expect(second).toEqual(first);

    const count = await prisma.repositoryWatch.count({
      where: {
        userId: viewerId,
        repositoryId: publicRepositoryId,
      },
    });

    expect(count).toBe(1);
  });

  it('allows the owner to watch a private repository', async () => {
    const result = await watchRepository(ownerId, ownerUsername, privateName);

    expect(result).toEqual({
      repositoryId: privateRepositoryId,
      watching: true,
    });

    const count = await prisma.repositoryWatch.count({
      where: {
        userId: ownerId,
        repositoryId: privateRepositoryId,
      },
    });

    expect(count).toBe(1);
  });

  it('allows a READ collaborator to watch a private repository', async () => {
    const result = await watchRepository(collaboratorId, ownerUsername, privateName);

    expect(result).toEqual({
      repositoryId: privateRepositoryId,
      watching: true,
    });

    const count = await prisma.repositoryWatch.count({
      where: {
        userId: collaboratorId,
        repositoryId: privateRepositoryId,
      },
    });

    expect(count).toBe(1);
  });

  it('rejects an unauthorized private repository watch', async () => {
    await expect(watchRepository(viewerId, ownerUsername, privateName)).rejects.toMatchObject({
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

  it('cascades watch deletion when its repository is deleted', async () => {
    await watchRepository(viewerId, ownerUsername, cascadeName);

    const before = await prisma.repositoryWatch.count({
      where: {
        repositoryId: cascadeRepositoryId,
        userId: viewerId,
      },
    });

    expect(before).toBe(1);

    await prisma.repository.delete({
      where: { id: cascadeRepositoryId },
    });

    const after = await prisma.repositoryWatch.count({
      where: {
        repositoryId: cascadeRepositoryId,
        userId: viewerId,
      },
    });

    expect(after).toBe(0);
  });
});
