import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import {
  starRepository,
  unstarRepository,
} from '../../../src/services/repositories/repository-star.service.js';

const runDatabaseTests = process.env.RUN_STAR_DATABASE_TEST === '1';

describe.skipIf(!runDatabaseTests)('unstarRepository PostgreSQL integration', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const username = `unstar_test_${suffix}`;
  const repositoryName = `unstar_repo_${suffix}`;

  let userId: string;
  let repositoryId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username,
        email: `${username}@example.invalid`,
        password: 'test-only-password-hash',
      },
      select: {
        id: true,
      },
    });

    userId = user.id;

    const repository = await prisma.repository.create({
      data: {
        name: repositoryName,
        ownerId: userId,
        isPrivate: false,
      },
      select: {
        id: true,
      },
    });

    repositoryId = repository.id;
  });

  afterAll(async () => {
    try {
      if (userId) {
        await prisma.repositoryStar.deleteMany({
          where: { userId },
        });

        await prisma.repository.deleteMany({
          where: { ownerId: userId },
        });

        await prisma.user.deleteMany({
          where: { id: userId },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('removes a persisted star from PostgreSQL', async () => {
    await starRepository(userId, username, repositoryName);

    const before = await prisma.repositoryStar.count({
      where: { userId, repositoryId },
    });

    expect(before).toBe(1);

    const result = await unstarRepository(
      userId,
      username,
      repositoryName,
    );

    expect(result).toEqual({
      repositoryId,
      starred: false,
    });

    const after = await prisma.repositoryStar.count({
      where: { userId, repositoryId },
    });

    expect(after).toBe(0);
  });

  it('allows repeated unstar without recreating the star', async () => {
    const first = await unstarRepository(
      userId,
      username,
      repositoryName,
    );

    const second = await unstarRepository(
      userId,
      username,
      repositoryName,
    );

    expect(first).toEqual({
      repositoryId,
      starred: false,
    });

    expect(second).toEqual(first);

    const count = await prisma.repositoryStar.count({
      where: { userId, repositoryId },
    });

    expect(count).toBe(0);
  });
});
