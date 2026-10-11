import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { starRepository } from '../../../src/services/repositories/repository-star.service.js';

const runDatabaseTests = process.env.RUN_STAR_DATABASE_TEST === '1';

describe.skipIf(!runDatabaseTests)('repository star real PostgreSQL verification', () => {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 16);
  const username = `star_test_${suffix}`;
  const repositoryName = `star_repo_${suffix}`;

  let userId: string | undefined;
  let repositoryId: string | undefined;

  afterAll(async () => {
    try {
      if (repositoryId) {
        await prisma.repositoryStar.deleteMany({
          where: { repositoryId },
        });

        await prisma.repository.delete({
          where: { id: repositoryId },
        });
      }

      if (userId) {
        await prisma.user.delete({
          where: { id: userId },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('persists exactly one star after repeated requests', async () => {
    const user = await prisma.user.create({
      data: {
        username,
        email: `${username}@example.invalid`,
        password: 'temporary-test-password-not-for-login',
      },
    });

    userId = user.id;

    const repository = await prisma.repository.create({
      data: {
        ownerId: user.id,
        name: repositoryName,
        isPrivate: false,
      },
    });

    repositoryId = repository.id;

    const first = await starRepository(user.id, username, repositoryName);
    const second = await starRepository(user.id, username, repositoryName);

    expect(first).toEqual({
      repositoryId: repository.id,
      starred: true,
    });

    expect(second).toEqual(first);

    const stars = await prisma.repositoryStar.findMany({
      where: {
        repositoryId: repository.id,
        userId: user.id,
      },
    });

    expect(stars).toHaveLength(1);
  });

  it('rejects unauthorized access to a private repository', async () => {
    if (!repositoryId) {
      throw new Error('Test repository was not created');
    }

    await prisma.repository.update({
      where: { id: repositoryId },
      data: { isPrivate: true },
    });

    await expect(
      starRepository('unauthorized-test-user', username, repositoryName),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    const unauthorizedStars = await prisma.repositoryStar.count({
      where: {
        repositoryId,
        userId: 'unauthorized-test-user',
      },
    });

    expect(unauthorizedStars).toBe(0);
  });
});
