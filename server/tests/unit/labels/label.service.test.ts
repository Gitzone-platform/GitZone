import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { Prisma } from '../../../src/generated/prisma/client.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import {
  createLabel,
  listLabels,
  getLabel,
  updateLabel,
  deleteLabel,
} from '../../../src/services/labels/label.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: vi.fn(),
    },
    label: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const findRepository = vi.mocked(prisma.repository.findFirst);
const authorize = vi.mocked(authorizeRepositoryAccess);

const createRecord = vi.mocked(prisma.label.create);
const findRecords = vi.mocked(prisma.label.findMany);
const findRecord = vi.mocked(prisma.label.findFirst);
const updateRecord = vi.mocked(prisma.label.update);
const deleteRecord = vi.mocked(prisma.label.delete);

const label = {
  id: 'label-1',
  repositoryId: 'repo-1',
  name: 'bug',
  color: '#FF5733',
  description: 'Bug reports',
  createdAt: new Date('2026-10-08T10:00:00Z'),
  updatedAt: new Date('2026-10-08T10:00:00Z'),
};

describe('Label service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findRepository.mockResolvedValue({ id: 'repo-1' } as never);
    authorize.mockResolvedValue(undefined as never);

    createRecord.mockResolvedValue(label);
    findRecords.mockResolvedValue([label]);
    findRecord.mockResolvedValue(label);
    updateRecord.mockResolvedValue(label);
    deleteRecord.mockResolvedValue(label);
  });

  it('returns 404 when repository does not exist', async () => {
    findRepository.mockResolvedValue(null as never);

    await expect(
      createLabel('user-1', 'owner', 'demo', {
        name: 'bug',
        color: '#FF5733',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(authorize).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('creates a label with WRITE permission', async () => {
    const result = await createLabel('user-1', 'owner', 'demo', {
      name: 'bug',
      color: '#FF5733',
      description: 'Bug reports',
    });

    expect(result).toEqual(label);

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');

    expect(createRecord).toHaveBeenCalledWith({
      data: {
        repositoryId: 'repo-1',
        name: 'bug',
        color: '#FF5733',
        description: 'Bug reports',
      },
    });
  });

  it('defaults missing description to null', async () => {
    await createLabel('user-1', 'owner', 'demo', {
      name: 'feature',
      color: '#00FF00',
    });

    expect(createRecord).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: null,
      }),
    });
  });

  it('denies creation when WRITE access is rejected', async () => {
    authorize.mockRejectedValue(
      Object.assign(new Error('Forbidden'), {
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );

    await expect(
      createLabel('reader-1', 'owner', 'demo', {
        name: 'bug',
        color: '#FF5733',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(createRecord).not.toHaveBeenCalled();
  });

  it('lists labels using READ permission', async () => {
    const result = await listLabels('owner', 'demo');

    expect(result).toEqual([label]);

    expect(authorize).toHaveBeenCalledWith('repo-1', 'READ', undefined);

    expect(findRecords).toHaveBeenCalledWith({
      where: { repositoryId: 'repo-1' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });

  it('gets only a label belonging to the repository', async () => {
    const result = await getLabel('owner', 'demo', 'label-1', 'user-1');

    expect(result).toEqual(label);

    expect(findRecord).toHaveBeenCalledWith({
      where: {
        id: 'label-1',
        repositoryId: 'repo-1',
      },
    });
  });

  it('returns 404 for a label outside the repository', async () => {
    findRecord.mockResolvedValue(null);

    await expect(getLabel('owner', 'demo', 'foreign-label')).rejects.toMatchObject({
      statusCode: 404,
      code: 'LABEL_NOT_FOUND',
    });
  });

  it('updates a label with WRITE permission', async () => {
    const result = await updateLabel('user-1', 'owner', 'demo', 'label-1', {
      color: '#00FF00',
    });

    expect(result).toEqual(label);

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');

    expect(updateRecord).toHaveBeenCalledWith({
      where: {
        id: 'label-1',
        repositoryId: 'repo-1',
      },
      data: {
        color: '#00FF00',
      },
    });
  });

  it('preserves explicitly null description on update', async () => {
    await updateLabel('user-1', 'owner', 'demo', 'label-1', {
      description: null,
    });

    expect(updateRecord).toHaveBeenCalledWith({
      where: {
        id: 'label-1',
        repositoryId: 'repo-1',
      },
      data: {
        description: null,
      },
    });
  });

  it('does not update a foreign repository label', async () => {
    findRecord.mockResolvedValue(null);

    await expect(
      updateLabel('user-1', 'owner', 'demo', 'foreign-label', { name: 'changed' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'LABEL_NOT_FOUND',
    });

    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('rejects duplicate label creation with 409', async () => {
    createRecord.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    await expect(
      createLabel('user-1', 'owner', 'demo', {
        name: 'bug',
        color: '#FF5733',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'LABEL_ALREADY_EXISTS',
    });
  });

  it('rejects duplicate label rename with 409', async () => {
    updateRecord.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    await expect(
      updateLabel('user-1', 'owner', 'demo', 'label-1', { name: 'existing-label' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'LABEL_ALREADY_EXISTS',
    });
  });
  it('deletes a label scoped to the repository', async () => {
    await deleteLabel('user-1', 'owner', 'demo', 'label-1');

    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');

    expect(deleteRecord).toHaveBeenCalledWith({
      where: {
        id: 'label-1',
        repositoryId: 'repo-1',
      },
    });
  });

  it('does not delete a foreign repository label', async () => {
    findRecord.mockResolvedValue(null);

    await expect(deleteLabel('user-1', 'owner', 'demo', 'foreign-label')).rejects.toMatchObject({
      statusCode: 404,
      code: 'LABEL_NOT_FOUND',
    });

    expect(deleteRecord).not.toHaveBeenCalled();
  });
});
