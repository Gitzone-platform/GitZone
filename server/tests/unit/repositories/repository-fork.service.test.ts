import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { AppError } from '../../../src/errors/app.error.js';
import { cloneBareGitRepositoryForFork } from '../../../src/services/git/git-fork.service.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import { forkRepository } from '../../../src/services/repositories/repository-fork.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

vi.mock('../../../src/services/git/git-fork.service.js', () => ({
  cloneBareGitRepositoryForFork: vi.fn(),
}));

const findSource = vi.mocked(prisma.repository.findFirst);
const findTarget = vi.mocked(prisma.repository.findUnique);
const findOwner = vi.mocked(prisma.user.findUnique);
const createRepository = vi.mocked(prisma.repository.create);
const deleteRepository = vi.mocked(prisma.repository.delete);
const authorize = vi.mocked(authorizeRepositoryAccess);
const cloneGit = vi.mocked(cloneBareGitRepositoryForFork);

const source = {
  id: 'source-1',
  ownerId: 'owner-1',
  name: 'project',
  description: 'Original project',
  isPrivate: false,
  defaultBranch: 'main',
};

const fork = {
  id: 'fork-1',
  ownerId: 'forker-1',
  name: 'project',
  description: 'Original project',
  isPrivate: false,
  defaultBranch: 'main',
  forkedFromId: 'source-1',
  createdAt: new Date('2026-10-12T00:00:00.000Z'),
  updatedAt: new Date('2026-10-12T00:00:00.000Z'),
};

describe('forkRepository service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findSource.mockResolvedValue(source as never);
    findOwner.mockResolvedValue({ username: 'forker' } as never);
    findTarget.mockResolvedValue(null);
    createRepository.mockResolvedValue(fork as never);
    deleteRepository.mockResolvedValue(fork as never);
    cloneGit.mockResolvedValue('isolated-git-path');

    authorize.mockResolvedValue({
      repositoryId: source.id,
      repositoryName: source.name,
      repositoryOwnerId: source.ownerId,
      repositoryOwnerUsername: 'sourceowner',
      isPrivate: false,
      permission: 'PUBLIC',
    });
  });

  it('returns 404 when source repository is missing', async () => {
    findSource.mockResolvedValue(null);

    await expect(
      forkRepository('forker-1', 'sourceowner', 'missing', {}),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(authorize).not.toHaveBeenCalled();
    expect(createRepository).not.toHaveBeenCalled();
  });

  it('authorizes READ access before creating a fork', async () => {
    await forkRepository('forker-1', 'sourceowner', 'project', {});

    expect(authorize).toHaveBeenCalledExactlyOnceWith(
      'source-1',
      'READ',
      'forker-1',
    );

    expect(createRepository).toHaveBeenCalledTimes(1);
  });

  it('denies unauthorized private source access', async () => {
    authorize.mockRejectedValue(
      new AppError('Access denied', 403, 'REPOSITORY_ACCESS_DENIED'),
    );

    await expect(
      forkRepository('forker-1', 'sourceowner', 'project', {}),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    expect(createRepository).not.toHaveBeenCalled();
    expect(cloneGit).not.toHaveBeenCalled();
  });

  it('returns 404 when target owner is missing', async () => {
    findOwner.mockResolvedValue(null);

    await expect(
      forkRepository('forker-1', 'sourceowner', 'project', {}),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(createRepository).not.toHaveBeenCalled();
  });

  it('rejects self-collision', async () => {
    findOwner.mockResolvedValue({ username: 'sourceowner' } as never);

    await expect(
      forkRepository('owner-1', 'sourceowner', 'project', {}),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'FORK_SELF_COLLISION',
    });

    expect(createRepository).not.toHaveBeenCalled();
  });

  it('allows owner fork with a different name', async () => {
    findOwner.mockResolvedValue({ username: 'sourceowner' } as never);
    createRepository.mockResolvedValue({
      ...fork,
      ownerId: 'owner-1',
      name: 'project-copy',
    } as never);

    await forkRepository('owner-1', 'sourceowner', 'project', {
      name: 'project-copy',
    });

    expect(createRepository).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: 'owner-1',
        name: 'project-copy',
        forkedFromId: 'source-1',
      }),
    });

    expect(cloneGit).toHaveBeenCalledExactlyOnceWith(
      'sourceowner',
      'project',
      'sourceowner',
      'project-copy',
    );
  });

  it('rejects an existing target repository', async () => {
    findTarget.mockResolvedValue(fork as never);

    await expect(
      forkRepository('forker-1', 'sourceowner', 'project', {}),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'REPOSITORY_ALREADY_EXISTS',
    });

    expect(createRepository).not.toHaveBeenCalled();
    expect(cloneGit).not.toHaveBeenCalled();
  });

  it('creates a fork with source metadata and relationship', async () => {
    const result = await forkRepository(
      'forker-1',
      'sourceowner',
      'project',
      {},
    );

    expect(createRepository).toHaveBeenCalledWith({
      data: {
        ownerId: 'forker-1',
        name: 'project',
        description: 'Original project',
        isPrivate: false,
        defaultBranch: 'main',
        forkedFromId: 'source-1',
      },
    });

    expect(cloneGit).toHaveBeenCalledExactlyOnceWith(
      'sourceowner',
      'project',
      'forker',
      'project',
    );

    expect(result).toMatchObject({
      id: 'fork-1',
      ownerId: 'forker-1',
      forkedFromId: 'source-1',
    });
  });

  it('accepts custom fork metadata', async () => {
    await forkRepository('forker-1', 'sourceowner', 'project', {
      name: 'custom-fork',
      description: 'My fork',
      isPrivate: true,
    });

    expect(createRepository).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'custom-fork',
        description: 'My fork',
        isPrivate: true,
      }),
    });
  });

  it('rolls back database row when Git clone fails', async () => {
    const gitError = new AppError(
      'Git clone failed',
      500,
      'GIT_FORK_CLONE_FAILED',
    );

    cloneGit.mockRejectedValue(gitError);

    await expect(
      forkRepository('forker-1', 'sourceowner', 'project', {}),
    ).rejects.toBe(gitError);

    expect(deleteRepository).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'fork-1' },
    });
  });

  it('returns rollback error when database cleanup fails', async () => {
    cloneGit.mockRejectedValue(new Error('Git clone failed'));
    deleteRepository.mockRejectedValue(new Error('Database unavailable'));

    await expect(
      forkRepository('forker-1', 'sourceowner', 'project', {}),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'FORK_ROLLBACK_FAILED',
    });

    expect(deleteRepository).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'fork-1' },
    });
  });

  it('propagates database creation failures without cloning', async () => {
    createRepository.mockRejectedValue(new Error('Database unavailable'));

    await expect(
      forkRepository('forker-1', 'sourceowner', 'project', {}),
    ).rejects.toThrow('Database unavailable');

    expect(cloneGit).not.toHaveBeenCalled();
    expect(deleteRepository).not.toHaveBeenCalled();
  });
});
