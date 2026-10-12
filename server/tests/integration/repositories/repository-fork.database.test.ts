import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { forkRepository } from '../../../src/services/repositories/repository-fork.service.js';
import { resolveGitRepositoryPath } from '../../../src/utils/git/repository-path.js';

const enabled = process.env.RUN_FORK_DATABASE_TEST === '1';

const isolatedStorage = vi.hoisted(() => ({
  root: '',
}));

vi.mock('../../../src/utils/git/repository-path.js', async () => {
  const path = await import('node:path');

  return {
    resolveGitRepositoryPath: (username: string, repositoryName: string) => {
      if (!isolatedStorage.root) {
        throw new Error('Fork test Git storage is not initialized');
      }

      const safeSegment = /^[a-zA-Z0-9._-]+$/;

      if (
        !safeSegment.test(username) ||
        !safeSegment.test(repositoryName) ||
        username === '.' ||
        username === '..' ||
        repositoryName === '.' ||
        repositoryName === '..'
      ) {
        throw new Error('Invalid isolated Git repository path');
      }

      return path.resolve(
        isolatedStorage.root,
        username,
        `${repositoryName}.git`,
      );
    },
  };
});

describe.skipIf(!enabled)('repository fork real PostgreSQL + Git', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const sourceUsername = `fork_src_${suffix}`;
  const targetUsername = `fork_dst_${suffix}`;
  const sourceName = `original_${suffix}`;
  const forkName = `copy_${suffix}`;
  const privateName = `private_${suffix}`;
  const rollbackName = `rollback_${suffix}`;
  const collisionName = `collision_${suffix}`;

  const userIds: string[] = [];
  const repositoryIds: string[] = [];

  let sourceOwnerId = '';
  let targetOwnerId = '';
  let sourceRepositoryId = '';
  let privateRepositoryId = '';

  let testRoot = '';
  let previousStorage: string | undefined;

  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();

  beforeAll(async () => {
    previousStorage = process.env.GIT_STORAGE_PATH;
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gitzone-fork-db-'));
    isolatedStorage.root = path.join(testRoot, 'repositories');

    const sourceOwner = await prisma.user.create({
      data: {
        username: sourceUsername,
        email: `${sourceUsername}@example.invalid`,
        password: 'temporary-test-password-not-for-login',
      },
    });
    userIds.push(sourceOwner.id);
    sourceOwnerId = sourceOwner.id;

    const targetOwner = await prisma.user.create({
      data: {
        username: targetUsername,
        email: `${targetUsername}@example.invalid`,
        password: 'temporary-test-password-not-for-login',
      },
    });
    userIds.push(targetOwner.id);
    targetOwnerId = targetOwner.id;

    const publicSource = await prisma.repository.create({
      data: {
        ownerId: sourceOwnerId,
        name: sourceName,
        description: 'Source fixture',
        defaultBranch: 'main',
        isPrivate: false,
      },
    });
    repositoryIds.push(publicSource.id);
    sourceRepositoryId = publicSource.id;

    const privateSource = await prisma.repository.create({
      data: {
        ownerId: sourceOwnerId,
        name: privateName,
        defaultBranch: 'main',
        isPrivate: true,
      },
    });
    repositoryIds.push(privateSource.id);
    privateRepositoryId = privateSource.id;

    await prisma.repositoryCollaborator.create({
      data: {
        repositoryId: privateRepositoryId,
        userId: targetOwnerId,
        permission: 'READ',
      },
    });

    const working = path.join(testRoot, 'working');
    await fs.mkdir(working, { recursive: true });

    git('init', '-b', 'main', working);
    git('-C', working, 'config', 'user.name', 'GitZone Test');
    git('-C', working, 'config', 'user.email', 'test@example.invalid');

    await fs.writeFile(path.join(working, 'README.md'), 'Fork integration test');

    git('-C', working, 'add', 'README.md');
    git('-C', working, 'commit', '-m', 'test: fork fixture');
    git('-C', working, 'branch', 'feature/test');

    const sourceGitPath = resolveGitRepositoryPath(
      sourceUsername,
      sourceName,
    );

    await fs.mkdir(path.dirname(sourceGitPath), { recursive: true });
    git('clone', '--bare', '--no-hardlinks', '--', working, sourceGitPath);
  });

  afterAll(async () => {
    try {
      if (repositoryIds.length > 0) {
        await prisma.repositoryCollaborator.deleteMany({
          where: { repositoryId: { in: repositoryIds } },
        });
        await prisma.repository.deleteMany({
          where: { id: { in: repositoryIds } },
        });
      }

      if (userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    } finally {
      await prisma.$disconnect();

      if (previousStorage === undefined) {
        delete process.env.GIT_STORAGE_PATH;
      } else {
        process.env.GIT_STORAGE_PATH = previousStorage;
      }

      if (testRoot) {
        await fs.rm(testRoot, { recursive: true, force: true });
      }

      isolatedStorage.root = '';
    }
  });

  it('creates a fork with correct database relationship and Git refs', async () => {
    const result = await forkRepository(
      targetOwnerId,
      sourceUsername,
      sourceName,
      { name: forkName },
    );

    repositoryIds.push(result.id);

    expect(result.forkedFromId).toBe(sourceRepositoryId);
    expect(result.ownerId).toBe(targetOwnerId);
    expect(result.defaultBranch).toBe('main');

    const databaseFork = await prisma.repository.findUnique({
      where: { id: result.id },
    });

    expect(databaseFork?.forkedFromId).toBe(sourceRepositoryId);

    const sourceGit = resolveGitRepositoryPath(sourceUsername, sourceName);
    const forkGit = resolveGitRepositoryPath(targetUsername, forkName);

    expect(git('--git-dir', forkGit, 'rev-parse', 'main')).toBe(
      git('--git-dir', sourceGit, 'rev-parse', 'main'),
    );

    expect(
      git('--git-dir', forkGit, 'show-ref', '--verify', 'refs/heads/feature/test'),
    ).toContain('refs/heads/feature/test');
  });

  it('rejects a public fork of private source', async () => {
    await expect(
      forkRepository(targetOwnerId, sourceUsername, privateName, {
        name: `public_${suffix}`,
        isPrivate: false,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORK_VISIBILITY_DENIED',
    });
  });

  it('rejects an existing target repository', async () => {
    await expect(
      forkRepository(targetOwnerId, sourceUsername, sourceName, {
        name: forkName,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'REPOSITORY_ALREADY_EXISTS',
    });
  });

  it('preserves an occupied Git destination and rolls back database row', async () => {
    const occupied = resolveGitRepositoryPath(targetUsername, collisionName);
    await fs.mkdir(occupied, { recursive: true });

    const sentinel = path.join(occupied, 'sentinel.txt');
    await fs.writeFile(sentinel, 'PRESERVE');

    await expect(
      forkRepository(targetOwnerId, sourceUsername, sourceName, {
        name: collisionName,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_REPOSITORY_ALREADY_EXISTS',
    });

    expect(await fs.readFile(sentinel, 'utf8')).toBe('PRESERVE');

    const databaseFork = await prisma.repository.findFirst({
      where: { ownerId: targetOwnerId, name: collisionName },
    });

    expect(databaseFork).toBeNull();
  });

  it('rolls back database row when source Git repository is missing', async () => {
    await expect(
      forkRepository(targetOwnerId, sourceUsername, privateName, {
        name: rollbackName,
        isPrivate: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'SOURCE_GIT_REPOSITORY_NOT_FOUND',
    });

    const databaseFork = await prisma.repository.findFirst({
      where: { ownerId: targetOwnerId, name: rollbackName },
    });

    expect(databaseFork).toBeNull();
  });
});
