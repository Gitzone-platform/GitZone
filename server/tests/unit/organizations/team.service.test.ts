import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedOrganizationFindUnique, mockedOrganizationMemberFindUnique, mockedTeamCreate } =
  vi.hoisted(() => ({
    mockedOrganizationFindUnique: vi.fn(),
    mockedOrganizationMemberFindUnique: vi.fn(),
    mockedTeamCreate: vi.fn(),
  }));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: {
      findUnique: mockedOrganizationFindUnique,
    },
    organizationMember: {
      findUnique: mockedOrganizationMemberFindUnique,
    },
    team: {
      create: mockedTeamCreate,
    },
  },
}));

const { createTeam } = await import('../../../src/services/organizations/team.service.js');

const input = {
  name: 'Frontend Team',
  slug: 'frontend-team',
};

describe('Create team service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedOrganizationFindUnique.mockResolvedValue({ id: 'org-1' });
    mockedOrganizationMemberFindUnique.mockResolvedValue({ role: 'OWNER' });
    mockedTeamCreate.mockResolvedValue({
      id: 'team-1',
      organizationId: 'org-1',
      name: input.name,
      slug: input.slug,
      description: null,
      createdAt: new Date('2026-10-21T00:00:00.000Z'),
      updatedAt: new Date('2026-10-21T00:00:00.000Z'),
    });
  });

  it('creates a team when the actor is the organization owner', async () => {
    const result = await createTeam('gitzone-platform', 'user-1', input);

    expect(result).toMatchObject({
      id: 'team-1',
      organizationId: 'org-1',
      name: 'Frontend Team',
      slug: 'frontend-team',
      description: null,
    });

    expect(mockedOrganizationFindUnique).toHaveBeenCalledWith({
      where: { slug: 'gitzone-platform' },
      select: { id: true },
    });

    expect(mockedOrganizationMemberFindUnique).toHaveBeenCalledWith({
      where: {
        organizationId_userId: {
          organizationId: 'org-1',
          userId: 'user-1',
        },
      },
      select: { role: true },
    });

    expect(mockedTeamCreate).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        name: 'Frontend Team',
        slug: 'frontend-team',
        description: null,
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('rejects creation when the organization does not exist', async () => {
    mockedOrganizationFindUnique.mockResolvedValueOnce(null);

    await expect(createTeam('missing-org', 'user-1', input)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mockedOrganizationMemberFindUnique).not.toHaveBeenCalled();
    expect(mockedTeamCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['a regular member', { role: 'MEMBER' }],
    ['a user who is not a member', null],
  ])('rejects creation for %s', async (_description, membership) => {
    mockedOrganizationMemberFindUnique.mockResolvedValueOnce(membership);

    await expect(createTeam('gitzone-platform', 'user-1', input)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mockedTeamCreate).not.toHaveBeenCalled();
  });

  it('maps duplicate team name or slug to a conflict error', async () => {
    const duplicateError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });

    mockedTeamCreate.mockRejectedValueOnce(duplicateError);

    await expect(createTeam('gitzone-platform', 'user-1', input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TEAM_ALREADY_EXISTS',
    });
  });

  it('propagates unexpected database errors', async () => {
    const databaseError = new Error('Database connection failed');

    mockedTeamCreate.mockRejectedValueOnce(databaseError);

    await expect(createTeam('gitzone-platform', 'user-1', input)).rejects.toBe(databaseError);
  });

  it('propagates errors from organization lookup', async () => {
    const databaseError = new Error('Organization lookup failed');

    mockedOrganizationFindUnique.mockRejectedValueOnce(databaseError);

    await expect(createTeam('gitzone-platform', 'user-1', input)).rejects.toBe(databaseError);

    expect(mockedTeamCreate).not.toHaveBeenCalled();
  });
});
