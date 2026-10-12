import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
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

const mockedSource = vi.mocked(prisma.repository.findFirst);
const mockedCreate = vi.mocked(prisma.repository.create);
const mockedOwner = vi.mocked(prisma.user.findUnique);
const mockedAuthorize = vi.mocked(authorizeRepositoryAccess);
const mockedClone = vi.mocked(cloneBareGitRepositoryForFork);

describe('repository fork visibility security', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedSource.mockResolvedValue({
      id: 'source-1',
      name: 'project',
      description: null,
      defaultBranch: 'main',
      isPrivate: true,
    } as never);

    mockedOwner.mockResolvedValue({
      username: 'forker',
    } as never);

    mockedAuthorize.mockResolvedValue({
      repositoryId: 'source-1',
      repositoryName: 'project',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'sourceowner',
      isPrivate: true,
      permission: 'READ',
    });
  });

  it('rejects a public fork of a private source', async () => {
    await expect(
      forkRepository('forker-1', 'sourceowner', 'project', {
        isPrivate: false,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORK_VISIBILITY_DENIED',
    });

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedClone).not.toHaveBeenCalled();
  });

  it('allows a private fork request past the visibility check', async () => {
    vi.mocked(prisma.repository.findUnique).mockResolvedValue(null);

    mockedCreate.mockResolvedValue({
      id: 'fork-1',
      ownerId: 'forker-1',
      name: 'project',
      description: null,
      isPrivate: true,
      defaultBranch: 'main',
      forkedFromId: 'source-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    mockedClone.mockResolvedValue('isolated-test-path');

    const result = await forkRepository(
      'forker-1',
      'sourceowner',
      'project',
      { isPrivate: true },
    );

    expect(result.isPrivate).toBe(true);

    expect(mockedCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isPrivate: true,
        forkedFromId: 'source-1',
      }),
    });
  });

  it('defaults private source forks to private', async () => {
    vi.mocked(prisma.repository.findUnique).mockResolvedValue(null);

    mockedCreate.mockResolvedValue({
      id: 'fork-2',
      ownerId: 'forker-1',
      name: 'project',
      description: null,
      isPrivate: true,
      defaultBranch: 'main',
      forkedFromId: 'source-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    mockedClone.mockResolvedValue('isolated-test-path');

    const result = await forkRepository(
      'forker-1',
      'sourceowner',
      'project',
      {},
    );

    expect(result.isPrivate).toBe(true);

    expect(mockedCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isPrivate: true,
      }),
    });
  });
});
