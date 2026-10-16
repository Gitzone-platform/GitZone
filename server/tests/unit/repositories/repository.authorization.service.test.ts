import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';

import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findUnique: vi.fn(),
    },
  },
}));

const mockedFindUnique = vi.mocked(prisma.repository.findUnique);

describe('authorizeRepositoryAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when repository does not exist', async () => {
    mockedFindUnique.mockResolvedValue(null as never);

    await expect(authorizeRepositoryAccess('repo-1', 'READ')).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });
  });

  it('rejects organization repositories through legacy authorization', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-org-1',
      name: 'demo',
      ownerId: 'legacy-user',
      organizationId: 'org-1',
      isPrivate: false,
      owner: { username: 'legacy-user' },
      collaborators: [],
    } as never);

    await expect(
      authorizeRepositoryAccess('repo-org-1', 'WRITE', 'legacy-user'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_REPOSITORY_AUTHORIZATION_REQUIRED',
    });

    await expect(
      authorizeRepositoryAccess('repo-org-1', 'READ', 'legacy-user'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_REPOSITORY_AUTHORIZATION_REQUIRED',
    });
  });

  it('allows repository owner to read', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: true,
      owner: {
        username: 'asil',
      },
      collaborators: [],
    } as never);

    const result = await authorizeRepositoryAccess('repo-1', 'READ', 'owner-1');

    expect(result.permission).toBe('OWNER');
  });

  it('allows repository owner to write', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: true,
      owner: {
        username: 'asil',
      },
      collaborators: [],
    } as never);

    const result = await authorizeRepositoryAccess('repo-1', 'WRITE', 'owner-1');

    expect(result.permission).toBe('OWNER');
  });

  it('allows anonymous read for public repository', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: false,
      owner: {
        username: 'asil',
      },
      collaborators: false,
    } as never);

    const result = await authorizeRepositoryAccess('repo-1', 'READ');

    expect(result.permission).toBe('PUBLIC');
  });

  it('allows READ collaborator to read', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: true,
      owner: {
        username: 'asil',
      },
      collaborators: [
        {
          permission: 'READ',
        },
      ],
    } as never);

    const result = await authorizeRepositoryAccess('repo-1', 'READ', 'user-1');

    expect(result.permission).toBe('READ');
  });

  it('denies WRITE access for READ collaborator', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: true,
      owner: {
        username: 'asil',
      },
      collaborators: [
        {
          permission: 'READ',
        },
      ],
    } as never);

    await expect(authorizeRepositoryAccess('repo-1', 'WRITE', 'user-1')).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });
  });

  it('allows WRITE collaborator to write', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: true,
      owner: {
        username: 'asil',
      },
      collaborators: [
        {
          permission: 'WRITE',
        },
      ],
    } as never);

    const result = await authorizeRepositoryAccess('repo-1', 'WRITE', 'user-1');

    expect(result.permission).toBe('WRITE');
  });

  it('denies anonymous read for private repository', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: true,
      owner: {
        username: 'asil',
      },
      collaborators: false,
    } as never);

    await expect(authorizeRepositoryAccess('repo-1', 'READ')).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });
  });

  it('allows WRITE collaborator to read', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: true,
      owner: {
        username: 'asil',
      },
      collaborators: [
        {
          permission: 'WRITE',
        },
      ],
    } as never);

    const result = await authorizeRepositoryAccess('repo-1', 'READ', 'user-1');

    expect(result.permission).toBe('WRITE');
  });

  it('allows unrelated authenticated user to read a public repository', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: false,
      owner: {
        username: 'asil',
      },
      collaborators: [],
    } as never);

    const result = await authorizeRepositoryAccess('repo-1', 'READ', 'unrelated-user');

    expect(result.permission).toBe('PUBLIC');
  });

  it('denies unrelated authenticated user from reading a private repository', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: true,
      owner: {
        username: 'asil',
      },
      collaborators: [],
    } as never);

    await expect(
      authorizeRepositoryAccess('repo-1', 'READ', 'unrelated-user'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });
  });

  it('denies unrelated authenticated user from writing to a public repository', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'repo-1',
      name: 'demo',
      ownerId: 'owner-1',
      isPrivate: false,
      owner: {
        username: 'asil',
      },
      collaborators: [],
    } as never);

    await expect(
      authorizeRepositoryAccess('repo-1', 'WRITE', 'unrelated-user'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });
  });
});
