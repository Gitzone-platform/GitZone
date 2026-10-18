import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { lookupGitRepository } from '../../../src/services/git/git-repository-lookup.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    namespaceEntry: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    repository: { findFirst: vi.fn() },
  },
}));

const findNamespace = vi.mocked(prisma.namespaceEntry.findUnique);
const findUser = vi.mocked(prisma.user.findUnique);
const findOrganization = vi.mocked(prisma.organization.findUnique);
const findRepository = vi.mocked(prisma.repository.findFirst);

const repository = {
  id: 'repo-1',
  name: 'backend',
  isPrivate: true,
  defaultBranch: 'main',
};

describe('lookupGitRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves a user-owned repository', async () => {
    findNamespace.mockResolvedValue({
      ownerType: 'USER',
      ownerId: 'user-1',
    } as never);

    findUser.mockResolvedValue({
      id: 'user-1',
      username: 'asil',
    } as never);

    findRepository.mockResolvedValue(repository as never);

    const result = await lookupGitRepository('asil', 'backend');

    expect(result.owner).toEqual({
      type: 'USER',
      id: 'user-1',
      name: 'asil',
    });

    expect(findRepository).toHaveBeenCalledWith({
      where: {
        name: 'backend',
        ownerId: 'user-1',
        organizationId: null,
      },
      select: {
        id: true,
        name: true,
        isPrivate: true,
        defaultBranch: true,
      },
    });
  });

  it('resolves an organization-owned repository', async () => {
    findNamespace.mockResolvedValue({
      ownerType: 'ORGANIZATION',
      ownerId: 'org-1',
    } as never);

    findOrganization.mockResolvedValue({
      id: 'org-1',
      slug: 'gitzone-team',
    } as never);

    findRepository.mockResolvedValue(repository as never);

    const result = await lookupGitRepository('gitzone-team', 'backend');

    expect(result.owner).toEqual({
      type: 'ORGANIZATION',
      id: 'org-1',
      name: 'gitzone-team',
    });

    expect(findRepository).toHaveBeenCalledWith({
      where: {
        name: 'backend',
        organizationId: 'org-1',
      },
      select: {
        id: true,
        name: true,
        isPrivate: true,
        defaultBranch: true,
      },
    });

    expect(findUser).not.toHaveBeenCalled();
  });

  it('rejects a missing namespace', async () => {
    findNamespace.mockResolvedValue(null);

    await expect(lookupGitRepository('missing', 'backend')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(findRepository).not.toHaveBeenCalled();
  });

  it('rejects an unknown namespace owner type', async () => {
    findNamespace.mockResolvedValue({
      ownerType: 'UNKNOWN',
      ownerId: 'unknown-1',
    } as never);

    await expect(lookupGitRepository('unknown', 'backend')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(findRepository).not.toHaveBeenCalled();
  });

  it('rejects a stale user namespace entry', async () => {
    findNamespace.mockResolvedValue({
      ownerType: 'USER',
      ownerId: 'user-1',
    } as never);

    findUser.mockResolvedValue({
      id: 'user-1',
      username: 'renamed-user',
    } as never);

    await expect(lookupGitRepository('asil', 'backend')).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(findRepository).not.toHaveBeenCalled();
  });

  it('rejects a stale organization namespace entry', async () => {
    findNamespace.mockResolvedValue({
      ownerType: 'ORGANIZATION',
      ownerId: 'org-1',
    } as never);

    findOrganization.mockResolvedValue({
      id: 'org-1',
      slug: 'renamed-team',
    } as never);

    await expect(lookupGitRepository('gitzone-team', 'backend')).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(findRepository).not.toHaveBeenCalled();
  });

  it('rejects a missing organization repository', async () => {
    findNamespace.mockResolvedValue({
      ownerType: 'ORGANIZATION',
      ownerId: 'org-1',
    } as never);

    findOrganization.mockResolvedValue({
      id: 'org-1',
      slug: 'gitzone-team',
    } as never);

    findRepository.mockResolvedValue(null);

    await expect(lookupGitRepository('gitzone-team', 'backend')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it.each(['../escape', '.', '..', 'team/name', ''])(
    'rejects an unsafe namespace "%s" before database access',
    async (namespace) => {
      await expect(lookupGitRepository(namespace, 'backend')).rejects.toMatchObject({
        code: 'INVALID_GIT_REPOSITORY_PATH',
      });

      expect(findNamespace).not.toHaveBeenCalled();
    },
  );

  it.each(['../escape', '.', '..', 'repo/name', ''])(
    'rejects an unsafe repository name "%s" before database access',
    async (name) => {
      await expect(lookupGitRepository('gitzone-team', name)).rejects.toMatchObject({
        code: 'INVALID_GIT_REPOSITORY_PATH',
      });

      expect(findNamespace).not.toHaveBeenCalled();
    },
  );
});
