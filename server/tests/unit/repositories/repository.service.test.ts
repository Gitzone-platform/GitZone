import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';

import {
  createGitRepository,
  finalizeStagedGitRepositoryDeletion,
  renameGitRepository,
  restoreStagedGitRepositoryDeletion,
  stageGitRepositoryDeletion,
} from '../../../src/services/git/git-repository.service.js';

import {
  createRepository,
  deleteRepository,
  getRepositoryByUsernameAndName,
  getUserRepositories,
  updateRepository,
} from '../../../src/services/repositories/repository.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/config/logger.js', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('../../../src/services/git/git-repository.service.js', () => ({
  createGitRepository: vi.fn(),
  finalizeStagedGitRepositoryDeletion: vi.fn(),
  renameGitRepository: vi.fn(),
  restoreStagedGitRepositoryDeletion: vi.fn(),
  stageGitRepositoryDeletion: vi.fn(),
}));

const mockedRepositoryFindUnique = vi.mocked(prisma.repository.findUnique);
const mockedRepositoryFindFirst = vi.mocked(prisma.repository.findFirst);
const mockedRepositoryFindMany = vi.mocked(prisma.repository.findMany);
const mockedRepositoryCreate = vi.mocked(prisma.repository.create);
const mockedRepositoryUpdate = vi.mocked(prisma.repository.update);
const mockedRepositoryDelete = vi.mocked(prisma.repository.delete);

const mockedUserFindUnique = vi.mocked(prisma.user.findUnique);

const mockedCreateGitRepository = vi.mocked(createGitRepository);
const mockedRenameGitRepository = vi.mocked(renameGitRepository);
const mockedStageGitRepositoryDeletion = vi.mocked(stageGitRepositoryDeletion);
const mockedRestoreStagedGitRepositoryDeletion = vi.mocked(restoreStagedGitRepositoryDeletion);
const mockedFinalizeStagedGitRepositoryDeletion = vi.mocked(finalizeStagedGitRepositoryDeletion);

const createdAt = new Date();
const updatedAt = new Date();

const stagedDeletion = {
  username: 'asil',
  repositoryName: 'demo',
  stagedRepositoryName: 'demo.deleting-test-id',
};

const baseRepository = {
  id: 'repo-1',
  ownerId: 'owner-1',
  name: 'demo',
  description: null,
  isPrivate: false,
  defaultBranch: 'main',
  createdAt,
  updatedAt,
};

describe('repository service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates a repository', async () => {
    mockedRepositoryFindUnique.mockResolvedValue(null as never);

    mockedRepositoryCreate.mockResolvedValue(baseRepository as never);

    mockedUserFindUnique.mockResolvedValue({
      username: 'asil',
    } as never);

    mockedCreateGitRepository.mockResolvedValue(undefined as never);

    const result = await createRepository('owner-1', {
      name: 'demo',
      description: 'Test repository',
      isPrivate: false,
    });

    expect(result.id).toBe('repo-1');
    expect(result.name).toBe('demo');

    expect(mockedCreateGitRepository).toHaveBeenCalledWith('asil', 'demo');
  });

  it('rejects duplicate repository', async () => {
    mockedRepositoryFindUnique.mockResolvedValue(baseRepository as never);

    await expect(
      createRepository('owner-1', {
        name: 'demo',
        description: undefined,
        isPrivate: false,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'REPOSITORY_ALREADY_EXISTS',
    });
  });

  it('rolls back database repository when owner does not exist', async () => {
    mockedRepositoryFindUnique.mockResolvedValue(null as never);

    mockedRepositoryCreate.mockResolvedValue(baseRepository as never);

    mockedUserFindUnique.mockResolvedValue(null as never);

    mockedRepositoryDelete.mockResolvedValue(baseRepository as never);

    await expect(
      createRepository('owner-1', {
        name: 'demo',
        isPrivate: false,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(mockedRepositoryDelete).toHaveBeenCalledWith({
      where: {
        id: 'repo-1',
      },
    });
  });

  it('rolls back database repository when git repository creation fails', async () => {
    mockedRepositoryFindUnique.mockResolvedValue(null as never);

    mockedRepositoryCreate.mockResolvedValue(baseRepository as never);

    mockedUserFindUnique.mockResolvedValue({
      username: 'asil',
    } as never);

    mockedCreateGitRepository.mockRejectedValue(new Error('Git init failed'));

    mockedRepositoryDelete.mockResolvedValue(baseRepository as never);

    await expect(
      createRepository('owner-1', {
        name: 'demo',
        isPrivate: false,
      }),
    ).rejects.toThrow('Git init failed');

    expect(mockedRepositoryDelete).toHaveBeenCalledOnce();
  });

  it('lists user repositories', async () => {
    mockedRepositoryFindMany.mockResolvedValue([
      baseRepository,
      {
        ...baseRepository,
        id: 'repo-2',
        name: 'demo-2',
      },
    ] as never);

    const result = await getUserRepositories('asil');

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('demo');
    expect(result[1]?.name).toBe('demo-2');
  });

  it('only queries public repositories when listing repositories by username', async () => {
    mockedRepositoryFindMany.mockResolvedValue([] as never);

    await getUserRepositories('asil');

    expect(mockedRepositoryFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: null,
        owner: {
          username: 'asil',
        },
        isPrivate: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  });

  it('only queries public repository when getting repository by username and name', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(null as never);

    await expect(getRepositoryByUsernameAndName('asil', 'private-demo')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(mockedRepositoryFindFirst).toHaveBeenCalledWith({
      where: {
        name: 'private-demo',
        organizationId: null,
        isPrivate: false,
        owner: {
          username: 'asil',
        },
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });
  });

  it('gets repository by username and name', async () => {
    mockedRepositoryFindFirst.mockResolvedValue({
      ...baseRepository,
      owner: {
        id: 'owner-1',
        username: 'asil',
        name: 'Asil',
        avatarUrl: null,
      },
    } as never);

    const result = await getRepositoryByUsernameAndName('asil', 'demo');

    expect(result.name).toBe('demo');
    expect(result.owner.username).toBe('asil');
  });

  it('throws 404 when repository is not found', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(null as never);

    await expect(getRepositoryByUsernameAndName('asil', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });
  });

  it('updates repository details', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedRepositoryUpdate.mockResolvedValue({
      ...baseRepository,
      description: 'Updated',
      isPrivate: true,
    } as never);

    const result = await updateRepository('owner-1', 'asil', 'demo', {
      description: 'Updated',
      isPrivate: true,
    });

    expect(result.description).toBe('Updated');
    expect(result.isPrivate).toBe(true);
  });

  it('denies repository update for non-owner', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    await expect(
      updateRepository('other-user', 'asil', 'demo', {
        description: 'Updated',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_FORBIDDEN',
    });
  });

  it('rejects rename when target repository name already exists', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedRepositoryFindUnique.mockResolvedValue({
      ...baseRepository,
      id: 'repo-2',
      name: 'new-name',
    } as never);

    await expect(
      updateRepository('owner-1', 'asil', 'demo', {
        name: 'new-name',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'REPOSITORY_ALREADY_EXISTS',
    });
  });

  it('renames git repository when repository name changes', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedRepositoryFindUnique.mockResolvedValue(null as never);

    mockedRenameGitRepository.mockResolvedValue(undefined as never);

    mockedRepositoryUpdate.mockResolvedValue({
      ...baseRepository,
      name: 'new-name',
    } as never);

    const result = await updateRepository('owner-1', 'asil', 'demo', {
      name: 'new-name',
    });

    expect(mockedRenameGitRepository).toHaveBeenCalledWith('asil', 'demo', 'new-name');

    expect(result.name).toBe('new-name');
  });

  it('deletes repository using staged filesystem deletion', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedStageGitRepositoryDeletion.mockResolvedValue(stagedDeletion);

    mockedRepositoryDelete.mockResolvedValue(baseRepository as never);

    mockedFinalizeStagedGitRepositoryDeletion.mockResolvedValue(undefined);

    await expect(deleteRepository('owner-1', 'asil', 'demo')).resolves.toBeUndefined();

    expect(mockedStageGitRepositoryDeletion).toHaveBeenCalledWith('asil', 'demo');

    expect(mockedRepositoryDelete).toHaveBeenCalledWith({
      where: {
        id: 'repo-1',
      },
    });

    expect(mockedFinalizeStagedGitRepositoryDeletion).toHaveBeenCalledWith(stagedDeletion);
  });

  it('denies repository deletion for non-owner', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    await expect(deleteRepository('other-user', 'asil', 'demo')).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_FORBIDDEN',
    });
  });

  it('does not delete database record when git deletion staging fails', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedStageGitRepositoryDeletion.mockRejectedValue(new Error('Git deletion staging failed'));

    await expect(deleteRepository('owner-1', 'asil', 'demo')).rejects.toThrow(
      'Git deletion staging failed',
    );

    expect(mockedRepositoryDelete).not.toHaveBeenCalled();
  });

  it('reports critical error when create database rollback fails', async () => {
    mockedRepositoryFindUnique.mockResolvedValue(null as never);

    mockedRepositoryCreate.mockResolvedValue(baseRepository as never);

    mockedUserFindUnique.mockResolvedValue({
      username: 'asil',
    } as never);

    mockedCreateGitRepository.mockRejectedValue(new Error('Git init failed'));

    mockedRepositoryDelete.mockRejectedValue(new Error('Database rollback failed'));

    await expect(
      createRepository('owner-1', {
        name: 'demo',
        isPrivate: false,
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'REPOSITORY_CREATE_ROLLBACK_FAILED',
    });
  });

  it('rolls back git rename when database update fails', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedRepositoryFindUnique.mockResolvedValue(null as never);

    mockedRenameGitRepository.mockResolvedValue(undefined);

    mockedRepositoryUpdate.mockRejectedValue(new Error('Database update failed'));

    await expect(
      updateRepository('owner-1', 'asil', 'demo', {
        name: 'new-name',
      }),
    ).rejects.toThrow('Database update failed');

    expect(mockedRenameGitRepository).toHaveBeenNthCalledWith(1, 'asil', 'demo', 'new-name');

    expect(mockedRenameGitRepository).toHaveBeenNthCalledWith(2, 'asil', 'new-name', 'demo');
  });

  it('reports critical error when git rename rollback fails', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedRepositoryFindUnique.mockResolvedValue(null as never);

    mockedRenameGitRepository
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Filesystem rollback failed'));

    mockedRepositoryUpdate.mockRejectedValue(new Error('Database update failed'));

    await expect(
      updateRepository('owner-1', 'asil', 'demo', {
        name: 'new-name',
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'REPOSITORY_RENAME_ROLLBACK_FAILED',
    });
  });

  it('restores staged git repository when database deletion fails', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedStageGitRepositoryDeletion.mockResolvedValue(stagedDeletion);

    mockedRepositoryDelete.mockRejectedValue(new Error('Database delete failed'));

    mockedRestoreStagedGitRepositoryDeletion.mockResolvedValue(undefined);

    await expect(deleteRepository('owner-1', 'asil', 'demo')).rejects.toThrow(
      'Database delete failed',
    );

    expect(mockedRestoreStagedGitRepositoryDeletion).toHaveBeenCalledWith(stagedDeletion);

    expect(mockedFinalizeStagedGitRepositoryDeletion).not.toHaveBeenCalled();
  });

  it('reports critical error when deletion rollback cannot restore git repository', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedStageGitRepositoryDeletion.mockResolvedValue(stagedDeletion);

    mockedRepositoryDelete.mockRejectedValue(new Error('Database delete failed'));

    mockedRestoreStagedGitRepositoryDeletion.mockRejectedValue(
      new Error('Filesystem restore failed'),
    );

    await expect(deleteRepository('owner-1', 'asil', 'demo')).rejects.toMatchObject({
      statusCode: 500,
      code: 'REPOSITORY_DELETE_ROLLBACK_FAILED',
    });
  });

  it('allows database deletion when git repository is already missing', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedStageGitRepositoryDeletion.mockResolvedValue(null);

    mockedRepositoryDelete.mockResolvedValue(baseRepository as never);

    await expect(deleteRepository('owner-1', 'asil', 'demo')).resolves.toBeUndefined();

    expect(mockedRepositoryDelete).toHaveBeenCalledOnce();

    expect(mockedFinalizeStagedGitRepositoryDeletion).not.toHaveBeenCalled();
  });

  it('does not fail logical deletion when post-delete filesystem cleanup fails', async () => {
    mockedRepositoryFindFirst.mockResolvedValue(baseRepository as never);

    mockedStageGitRepositoryDeletion.mockResolvedValue(stagedDeletion);

    mockedRepositoryDelete.mockResolvedValue(baseRepository as never);

    mockedFinalizeStagedGitRepositoryDeletion.mockRejectedValue(new Error('Cleanup failed'));

    await expect(deleteRepository('owner-1', 'asil', 'demo')).resolves.toBeUndefined();
  });
});
