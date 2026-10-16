import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { authorizeOrganizationRepositoryAccess } from '../../../src/services/repositories/organization-repository-authorization.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: { findUnique: vi.fn() },
    organizationMember: { findUnique: vi.fn() },
  },
}));

const findRepository = vi.mocked(prisma.repository.findUnique);
const findMembership = vi.mocked(prisma.organizationMember.findUnique);

const repository = {
  id: 'repo-1',
  name: 'demo',
  ownerId: 'legacy-user',
  organizationId: 'org-1',
  organization: { id: 'org-1', slug: 'team' },
  isPrivate: true,
  collaborators: [],
};

describe('authorizeOrganizationRepositoryAccess', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findRepository.mockResolvedValue(repository as never);
    findMembership.mockResolvedValue(null);
  });

  it('rejects a repository without organization ownership', async () => {
    findRepository.mockResolvedValue({
      ...repository,
      organizationId: null,
      organization: null,
    } as never);

    await expect(
      authorizeOrganizationRepositoryAccess('repo-1', 'READ', 'user-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('allows organization owner to write', async () => {
    findMembership.mockResolvedValue({ role: 'OWNER' } as never);

    const result = await authorizeOrganizationRepositoryAccess('repo-1', 'WRITE', 'owner-1');

    expect(result.permission).toBe('OWNER');
  });

  it('allows organization member to read private repository', async () => {
    findMembership.mockResolvedValue({ role: 'MEMBER' } as never);

    const result = await authorizeOrganizationRepositoryAccess('repo-1', 'READ', 'member-1');

    expect(result.permission).toBe('MEMBER');
  });

  it('denies organization member write without collaborator permission', async () => {
    findMembership.mockResolvedValue({ role: 'MEMBER' } as never);

    await expect(
      authorizeOrganizationRepositoryAccess('repo-1', 'WRITE', 'member-1'),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows WRITE collaborator to write', async () => {
    findRepository.mockResolvedValue({
      ...repository,
      collaborators: [{ permission: 'WRITE' }],
    } as never);

    const result = await authorizeOrganizationRepositoryAccess('repo-1', 'WRITE', 'collaborator-1');

    expect(result.permission).toBe('WRITE');
  });

  it('denies anonymous read of private repository', async () => {
    await expect(authorizeOrganizationRepositoryAccess('repo-1', 'READ')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('allows anonymous read of public repository', async () => {
    findRepository.mockResolvedValue({
      ...repository,
      isPrivate: false,
      collaborators: false,
    } as never);

    const result = await authorizeOrganizationRepositoryAccess('repo-1', 'READ');

    expect(result.permission).toBe('PUBLIC');
  });
});
