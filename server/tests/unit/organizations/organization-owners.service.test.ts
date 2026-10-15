import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockedOrganizationFindUnique,
  mockedMemberFindUnique,
  mockedMemberFindMany,
} = vi.hoisted(() => ({
  mockedOrganizationFindUnique: vi.fn(),
  mockedMemberFindUnique: vi.fn(),
  mockedMemberFindMany: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: {
      findUnique: mockedOrganizationFindUnique,
    },
    organizationMember: {
      findUnique: mockedMemberFindUnique,
      findMany: mockedMemberFindMany,
    },
  },
}));

const { listOrganizationOwners } =
  await import('../../../src/services/organizations/organization.service.js');

const owner = {
  id: 'user-1',
  username: 'owner1',
  name: 'Owner One',
  avatarUrl: null,
};

describe('Organization owners service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedOrganizationFindUnique.mockResolvedValue({
      id: 'org-1',
      visibility: 'PUBLIC',
    });

    mockedMemberFindMany.mockResolvedValue([
      { user: owner },
    ]);
  });

  it('lists owners of a public organization without authentication', async () => {
    await expect(
      listOrganizationOwners('gitzone-platform'),
    ).resolves.toEqual([owner]);

    expect(mockedMemberFindUnique).not.toHaveBeenCalled();

    expect(mockedMemberFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        role: 'OWNER',
      },
      select: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  });

  it('allows a member to list private organization owners', async () => {
    mockedOrganizationFindUnique.mockResolvedValue({
      id: 'org-1',
      visibility: 'PRIVATE',
    });

    mockedMemberFindUnique.mockResolvedValue({
      id: 'membership-1',
    });

    await expect(
      listOrganizationOwners('private-org', 'user-2'),
    ).resolves.toEqual([owner]);

    expect(mockedMemberFindUnique).toHaveBeenCalledWith({
      where: {
        organizationId_userId: {
          organizationId: 'org-1',
          userId: 'user-2',
        },
      },
      select: { id: true },
    });
  });

  it('hides private organization owners from guests', async () => {
    mockedOrganizationFindUnique.mockResolvedValue({
      id: 'org-1',
      visibility: 'PRIVATE',
    });

    await expect(
      listOrganizationOwners('private-org'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mockedMemberFindMany).not.toHaveBeenCalled();
  });

  it('hides private organization owners from non-members', async () => {
    mockedOrganizationFindUnique.mockResolvedValue({
      id: 'org-1',
      visibility: 'PRIVATE',
    });

    mockedMemberFindUnique.mockResolvedValue(null);

    await expect(
      listOrganizationOwners('private-org', 'outsider'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mockedMemberFindMany).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown organization', async () => {
    mockedOrganizationFindUnique.mockResolvedValue(null);

    await expect(
      listOrganizationOwners('missing-org'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mockedMemberFindMany).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    const error = new Error('Database unavailable');

    mockedOrganizationFindUnique.mockRejectedValue(error);

    await expect(
      listOrganizationOwners('gitzone-platform'),
    ).rejects.toBe(error);

    expect(mockedMemberFindMany).not.toHaveBeenCalled();
  });
});