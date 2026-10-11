import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import {
  getRepositoryStarCount,
  starRepository,
  unstarRepository,
} from '../../../src/services/repositories/repository-star.service.js';

const runDatabaseTests = process.env.RUN_STAR_DATABASE_TEST === '1';

describe.skipIf(!runDatabaseTests)('repository star count real PostgreSQL integration', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const username = `count_test_${suffix}`;
  const repositoryName = `count_repo_${suffix}`;

  let ownerId: string | undefined;
  let secondUserId: string | undefined;
  let repositoryId: string | undefined;

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        username,
        email: `${username}@example.invalid`,
        password: 'temporary-test-password-not-for-login',
      },
      select: { id: true },
    });

    ownerId = owner.id;

    const secondUser = await prisma.user.create({
      data: {
        username: `count_other_${suffix}`,
        email: `count_other_${suffix}@example.invalid`,
        password: 'temporary-test-password-not-for-login',
      },
      select: { id: true },
    });

    secondUserId = secondUser.id;

    const repository = await prisma.repository.create({
      data: {
        ownerId: owner.id,
        name: repositoryName,
        isPrivate: false,
      },
      select: { id: true },
    });

    repositoryId = repository.id;
  });

  afterAll(async () => {
    try {
      if (repositoryId) {
        await prisma.repositoryStar.deleteMany({
          where: { repositoryId },
        });

        await prisma.repository.deleteMany({
          where: { id: repositoryId },
        });
      }

      if (secondUserId) {
        await prisma.user.deleteMany({
          where: { id: secondUserId },
        });
      }

      if (ownerId) {
        await prisma.user.deleteMany({
          where: { id: ownerId },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('counts 0, 1, and 2 persisted stars correctly', async () => {
    if (!ownerId || !secondUserId || !repositoryId) {
      throw new Error('Test fixtures were not initialized');
    }

    const initial = await getRepositoryStarCount(username, repositoryName);

    expect(initial).toEqual({
      repositoryId,
      starCount: 0,
    });

    await starRepository(ownerId, username, repositoryName);

    const afterFirst = await getRepositoryStarCount(username, repositoryName);

    expect(afterFirst.starCount).toBe(1);

    await starRepository(secondUserId, username, repositoryName);

    const afterSecond = await getRepositoryStarCount(username, repositoryName);

    expect(afterSecond.starCount).toBe(2);

    await starRepository(ownerId, username, repositoryName);

    const afterDuplicate = await getRepositoryStarCount(username, repositoryName);

    expect(afterDuplicate.starCount).toBe(2);
  });

  it('updates the count after unstar operations', async () => {
    if (!ownerId || !secondUserId || !repositoryId) {
      throw new Error('Test fixtures were not initialized');
    }

    await unstarRepository(ownerId, username, repositoryName);

    const afterFirst = await getRepositoryStarCount(username, repositoryName);

    expect(afterFirst.starCount).toBe(1);

    await unstarRepository(secondUserId, username, repositoryName);

    const afterSecond = await getRepositoryStarCount(username, repositoryName);

    expect(afterSecond.starCount).toBe(0);
  });

  it('prevents unauthorized star count access to private repositories', async () => {
    if (!ownerId || !repositoryId) {
      throw new Error('Test fixtures were not initialized');
    }

    await prisma.repository.update({
      where: { id: repositoryId },
      data: { isPrivate: true },
    });

    await expect(
      getRepositoryStarCount(username, repositoryName),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    await expect(
      getRepositoryStarCount(username, repositoryName, ownerId),
    ).resolves.toEqual({
      repositoryId,
      starCount: 0,
    });
  });
});
