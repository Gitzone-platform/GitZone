import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  memberFindUnique: vi.fn(),
  repositoryFindUnique: vi.fn(),
  repositoryCreate: vi.fn(),
  repositoryDelete: vi.fn(),
  createGit: vi.fn(),
  writeLock: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: {
      findUnique: mocks.organizationFindUnique,
    },
    organizationMember: {
      findUnique: mocks.memberFindUnique,
    },
    repository: {
      findUnique: mocks.repositoryFindUnique,
      create: mocks.repositoryCreate,
      delete: mocks.repositoryDelete,
    },
  },
}));

vi.mock('../../../src/config/logger.js', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

vi.mock('../../../src/services/git/git-repository.service.js', () => ({
  createOrganizationGitRepository: mocks.createGit,
}));

vi.mock('../../../src/services/git/git-user-lock.service.js', () => ({
  withGitNamespaceWriteLock: mocks.writeLock,
}));

const { createOrganizationRepository } = await import(
  '../../../src/services/repositories/organization-repository-create.service.js'
);

const repository = {
  id: 'repo-1',
  ownerId: null,
  organizationId: 'org-1',
  name: 'demo',
  description: null,
  isPrivate: false,
  defaultBranch: 'main',
  createdAt: new Date('2026-10-17T00:00:00.000Z'),
  updatedAt: new Date('2026-10-17T00:00:00.000Z'),
};

const input = {
  name: 'demo',
  isPrivate: false,
};

describe('organization repository creation service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.organizationFindUnique.mockImplementation(async ({ where }) => {
      if (where.slug === 'gitzone') {
        return { id: 'org-1' };
      }

      if (where.id === 'org-1') {
        return { id: 'org-1', slug: 'gitzone' };
      }

      return null;
    });

    mocks.memberFindUnique.mockResolvedValue({ role: 'OWNER' });
    mocks.repositoryFindUnique.mockResolvedValue(null);
    mocks.repositoryCreate.mockResolvedValue(repository);
    mocks.repositoryDelete.mockResolvedValue(repository);
    mocks.createGit.mockResolvedValue(undefined);

    mocks.writeLock.mockImplementation(async (_owner, operation) => operation());
  });

  it('creates an organization repository as OWNER', async () => {
    const result = await createOrganizationRepository(
      'gitzone',
      'user-1',
      input,
    );

    expect(result).toMatchObject({
      id: 'repo-1',
      ownerId: null,
      organizationId: 'org-1',
      name: 'demo',
    });

    expect(mocks.writeLock).toHaveBeenCalledWith(
      { type: 'ORGANIZATION', id: 'org-1' },
      expect.any(Function),
    );

    expect(mocks.memberFindUnique).toHaveBeenCalledWith({
      where: {
        organizationId_userId: {
          organizationId: 'org-1',
          userId: 'user-1',
        },
      },
      select: { role: true },
    });

    expect(mocks.repositoryCreate).toHaveBeenCalledWith({
      data: {
        ownerId: null,
        organizationId: 'org-1',
        name: 'demo',
        description: null,
        isPrivate: false,
      },
    });

    expect(mocks.createGit).toHaveBeenCalledWith('gitzone', 'demo');
  });

  it('rejects an unknown organization', async () => {
    mocks.organizationFindUnique.mockResolvedValue(null);

    await expect(
      createOrganizationRepository('missing', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mocks.writeLock).not.toHaveBeenCalled();
    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });

  it('rejects a MEMBER', async () => {
    mocks.memberFindUnique.mockResolvedValue({ role: 'MEMBER' });

    await expect(
      createOrganizationRepository('gitzone', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
    expect(mocks.createGit).not.toHaveBeenCalled();
  });

  it('rejects a user without membership', async () => {
    mocks.memberFindUnique.mockResolvedValue(null);

    await expect(
      createOrganizationRepository('gitzone', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });

  it('rejects duplicate repository names', async () => {
    mocks.repositoryFindUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      createOrganizationRepository('gitzone', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'REPOSITORY_ALREADY_EXISTS',
    });

    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });

  it('maps database uniqueness conflicts to HTTP 409', async () => {
    mocks.repositoryCreate.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      }),
    );

    await expect(
      createOrganizationRepository('gitzone', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'REPOSITORY_ALREADY_EXISTS',
    });

    expect(mocks.createGit).not.toHaveBeenCalled();
  });

  it('rolls back database creation when Git initialization fails', async () => {
    const gitError = new Error('Git initialization failed');
    mocks.createGit.mockRejectedValue(gitError);

    await expect(
      createOrganizationRepository('gitzone', 'user-1', input),
    ).rejects.toBe(gitError);

    expect(mocks.repositoryDelete).toHaveBeenCalledWith({
      where: { id: 'repo-1' },
    });
  });

  it('reports rollback failure without hiding the incident', async () => {
    mocks.createGit.mockRejectedValue(new Error('Git failed'));
    mocks.repositoryDelete.mockRejectedValue(new Error('Database unavailable'));

    await expect(
      createOrganizationRepository('gitzone', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'ORGANIZATION_REPOSITORY_CREATE_ROLLBACK_FAILED',
    });

    expect(mocks.loggerError).toHaveBeenCalledOnce();
  });

  it('rejects organization deletion while waiting for the lock', async () => {
    mocks.organizationFindUnique
      .mockResolvedValueOnce({ id: 'org-1' })
      .mockResolvedValueOnce(null);

    await expect(
      createOrganizationRepository('gitzone', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });

  it('rejects an organization slug change while waiting for the lock', async () => {
    mocks.organizationFindUnique
      .mockResolvedValueOnce({ id: 'org-1' })
      .mockResolvedValueOnce({ id: 'org-1', slug: 'renamed' });

    await expect(
      createOrganizationRepository('gitzone', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mocks.repositoryCreate).not.toHaveBeenCalled();
  });
});
