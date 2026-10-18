import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { getUserStarredRepositories } from '../../../src/services/profiles/profile-starred.service.js';
import {
  starRepository,
  unstarRepository,
} from '../../../src/services/repositories/repository-star.service.js';

const runDatabaseTests = process.env.RUN_STAR_DATABASE_TEST === '1';

describe.skipIf(!runDatabaseTests)(
  'profile starred repositories real PostgreSQL integration',
  () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const username = `starred_test_${suffix}`;
    const ownerUsername = `starred_owner_${suffix}`;
    const collaboratorUsername = `starred_collab_${suffix}`;
    const strangerUsername = `starred_other_${suffix}`;

    const publicName = `starred_public_${suffix}`;
    const privateName = `starred_private_${suffix}`;
    const secondPublicName = `starred_second_${suffix}`;

    const createdUserIds: string[] = [];
    const createdRepositoryIds: string[] = [];

    let userId = '';
    let ownerId = '';
    let collaboratorId = '';
    let strangerId = '';
    let publicRepositoryId = '';
    let privateRepositoryId = '';
    let secondPublicRepositoryId = '';

    const list = (viewerId?: string, page = 1, limit = 20) =>
      getUserStarredRepositories(username, viewerId, { page, limit });

    beforeAll(async () => {
      const users = [username, ownerUsername, collaboratorUsername, strangerUsername];

      for (const name of users) {
        const user = await prisma.user.create({
          data: {
            username: name,
            email: `${name}@example.invalid`,
            password: 'temporary-test-password-not-for-login',
          },
          select: { id: true },
        });

        createdUserIds.push(user.id);
      }

      const [createdUserId, createdOwnerId, createdCollaboratorId, createdStrangerId] =
        createdUserIds;

      if (!createdUserId || !createdOwnerId || !createdCollaboratorId || !createdStrangerId) {
        throw new Error('User fixtures were not initialized');
      }

      userId = createdUserId;
      ownerId = createdOwnerId;
      collaboratorId = createdCollaboratorId;
      strangerId = createdStrangerId;

      for (const item of [
        { name: publicName, isPrivate: false },
        { name: privateName, isPrivate: true },
        { name: secondPublicName, isPrivate: false },
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

      const [createdPublicId, createdPrivateId, createdSecondPublicId] = createdRepositoryIds;

      if (!createdPublicId || !createdPrivateId || !createdSecondPublicId) {
        throw new Error('Repository fixtures were not initialized');
      }

      publicRepositoryId = createdPublicId;
      privateRepositoryId = createdPrivateId;
      secondPublicRepositoryId = createdSecondPublicId;

      await prisma.repositoryStar.createMany({
        data: [
          { userId, repositoryId: publicRepositoryId },
          { userId, repositoryId: privateRepositoryId },
          { userId, repositoryId: secondPublicRepositoryId },
        ],
      });
    });

    afterAll(async () => {
      try {
        if (createdRepositoryIds.length > 0) {
          await prisma.repositoryStar.deleteMany({
            where: { repositoryId: { in: createdRepositoryIds } },
          });

          await prisma.repositoryCollaborator.deleteMany({
            where: { repositoryId: { in: createdRepositoryIds } },
          });

          await prisma.repository.deleteMany({
            where: { id: { in: createdRepositoryIds } },
          });
        }

        if (createdUserIds.length > 0) {
          await prisma.user.deleteMany({
            where: { id: { in: createdUserIds } },
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    });

    it('shows only public repositories to anonymous viewers', async () => {
      const result = await list();

      expect(result.repositories).toHaveLength(2);
      expect(result.repositories.every((repo) => !repo.isPrivate)).toBe(true);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('hides private repositories and counts from strangers', async () => {
      const result = await list(strangerId);

      expect(result.repositories).toHaveLength(2);
      expect(result.repositories.some((repo) => repo.id === privateRepositoryId)).toBe(false);
      expect(result.pagination.total).toBe(2);
    });

    it('allows the repository owner to see private starred repositories', async () => {
      const result = await list(ownerId);

      expect(result.repositories).toHaveLength(3);
      expect(result.repositories.some((repo) => repo.id === privateRepositoryId)).toBe(true);
      expect(result.pagination.total).toBe(3);
    });

    it('allows READ collaborators to see private starred repositories', async () => {
      await prisma.repositoryCollaborator.create({
        data: {
          repositoryId: privateRepositoryId,
          userId: collaboratorId,
          permission: 'READ',
        },
      });

      const result = await list(collaboratorId);

      expect(result.repositories).toHaveLength(3);
      expect(result.repositories.some((repo) => repo.id === privateRepositoryId)).toBe(true);
    });

    it('allows WRITE collaborators to see private starred repositories', async () => {
      await prisma.repositoryCollaborator.update({
        where: {
          repositoryId_userId: {
            repositoryId: privateRepositoryId,
            userId: collaboratorId,
          },
        },
        data: { permission: 'WRITE' },
      });

      const result = await list(collaboratorId);

      expect(result.repositories).toHaveLength(3);
      expect(result.repositories.some((repo) => repo.id === privateRepositoryId)).toBe(true);
    });

    it('paginates only visible repositories', async () => {
      const firstPage = await list(undefined, 1, 1);
      const secondPage = await list(undefined, 2, 1);
      const thirdPage = await list(undefined, 3, 1);

      expect(firstPage.repositories).toHaveLength(1);
      expect(secondPage.repositories).toHaveLength(1);
      expect(thirdPage.repositories).toHaveLength(0);

      expect(firstPage.repositories[0]?.id).not.toBe(secondPage.repositories[0]?.id);

      expect(firstPage.pagination).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });

      expect(thirdPage.pagination.total).toBe(2);
    });

    it('updates the list after unstar and star operations', async () => {
      await unstarRepository(userId, ownerUsername, publicName);

      const afterUnstar = await list();

      expect(afterUnstar.pagination.total).toBe(1);
      expect(afterUnstar.repositories.some((repo) => repo.id === publicRepositoryId)).toBe(false);

      await starRepository(userId, ownerUsername, publicName);

      const afterStar = await list();

      expect(afterStar.pagination.total).toBe(2);
      expect(afterStar.repositories.some((repo) => repo.id === publicRepositoryId)).toBe(true);
    });

    it('rejects nonexistent profiles', async () => {
      await expect(
        getUserStarredRepositories(`missing_${suffix}`, undefined, { page: 1, limit: 20 }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
      });
    });
  },
);
