import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedOrganizationFindUnique, mockedMemberFindUnique, mockedMemberFindMany } = vi.hoisted(
  () => ({
    mockedOrganizationFindUnique: vi.fn(),
    mockedMemberFindUnique: vi.fn(),
    mockedMemberFindMany: vi.fn(),
  }),
);

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

const { listOrganizationMembers } =
  await import('../../../src/services/organizations/organization.service.js');

const joinedAt = new Date('2026-10-01T10:00:00.000Z');

const owner = {
  id: 'user-1',
  username: 'owner1',
  name: 'Owner One',
  avatarUrl: null,
};

const member = {
  id: 'user-2',
  username: 'member2',
  name: 'Member Two',
  avatarUrl: 'https://example.com/avatar.png',
};

const memberships = [
  {
    user: owner,
    role: 'OWNER',
    createdAt: joinedAt,
  },
  {
    user: member,
    role: 'MEMBER',
    createdAt: joinedAt,
  },
];

describe('Organization members service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedOrganizationFindUnique.mockResolvedValue({
      id: 'org-1',
      visibility: 'PUBLIC',
    });

    mockedMemberFindMany.mockResolvedValue(memberships);
  });

  it('lists public organization members without authentication', async () => {
    const result = await listOrganizationMembers('public-org');

    expect(result).toEqual([
      {
        ...owner,
        role: 'OWNER',
        joinedAt,
      },
      {
        ...member,
        role: 'MEMBER',
        joinedAt,
      },
    ]);

    expect(mockedMemberFindUnique).not.toHaveBeenCalled();

    expect(mockedMemberFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
      },
      select: {
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('allows members to view private organization members', async () => {
    mockedOrganizationFindUnique.mockResolvedValue({
      id: 'org-1',
      visibility: 'PRIVATE',
    });

    mockedMemberFindUnique.mockResolvedValue({
      id: 'membership-1',
    });

    const result = await listOrganizationMembers('private-org', 'user-2');

    expect(result).toHaveLength(2);

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

  it('hides private organization members from guests', async () => {
    mockedOrganizationFindUnique.mockResolvedValue({
      id: 'org-1',
      visibility: 'PRIVATE',
    });

    await expect(listOrganizationMembers('private-org')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mockedMemberFindMany).not.toHaveBeenCalled();
  });

  it('hides private organization members from outsiders', async () => {
    mockedOrganizationFindUnique.mockResolvedValue({
      id: 'org-1',
      visibility: 'PRIVATE',
    });

    mockedMemberFindUnique.mockResolvedValue(null);

    await expect(listOrganizationMembers('private-org', 'outsider')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mockedMemberFindMany).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing organization', async () => {
    mockedOrganizationFindUnique.mockResolvedValue(null);

    await expect(listOrganizationMembers('missing-org')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mockedMemberFindMany).not.toHaveBeenCalled();
  });

  it('returns an empty array when there are no memberships', async () => {
    mockedMemberFindMany.mockResolvedValue([]);

    await expect(listOrganizationMembers('public-org')).resolves.toEqual([]);
  });

  it('propagates database errors', async () => {
    const error = new Error('Database unavailable');

    mockedMemberFindMany.mockRejectedValue(error);

    await expect(listOrganizationMembers('public-org')).rejects.toBe(error);
  });
});
