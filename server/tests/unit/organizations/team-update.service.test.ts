import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockedOrganizationFindUnique,
  mockedOrganizationMemberFindUnique,
  mockedTeamFindFirst,
  mockedTeamUpdate,
} = vi.hoisted(() => ({
  mockedOrganizationFindUnique: vi.fn(),
  mockedOrganizationMemberFindUnique: vi.fn(),
  mockedTeamFindFirst: vi.fn(),
  mockedTeamUpdate: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: { findUnique: mockedOrganizationFindUnique },
    organizationMember: { findUnique: mockedOrganizationMemberFindUnique },
    team: {
      findFirst: mockedTeamFindFirst,
      update: mockedTeamUpdate,
    },
  },
}));

const { updateTeam } = await import('../../../src/services/organizations/team.service.js');

const baseTeam = {
  id: 'team-1',
  organizationId: 'org-1',
  name: 'Frontend Team',
  slug: 'frontend-team',
  description: 'Frontend development team',
  createdAt: new Date('2026-10-21T00:00:00.000Z'),
  updatedAt: new Date('2026-10-21T00:00:00.000Z'),
};

describe('Update team service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedOrganizationFindUnique.mockResolvedValue({ id: 'org-1' });
    mockedOrganizationMemberFindUnique.mockResolvedValue({ role: 'OWNER' });
    mockedTeamFindFirst.mockResolvedValue({ id: 'team-1' });
    mockedTeamUpdate.mockResolvedValue({
      ...baseTeam,
      name: 'Updated Frontend Team',
    });
  });

  it('updates a team belonging to the organization for its owner', async () => {
    const result = await updateTeam('gitzone-platform', 'team-1', 'user-1', {
      name: 'Updated Frontend Team',
    });

    expect(result.name).toBe('Updated Frontend Team');
    expect(mockedTeamFindFirst).toHaveBeenCalledWith({
      where: { id: 'team-1', organizationId: 'org-1' },
      select: { id: true },
    });
    expect(mockedTeamUpdate).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      data: { name: 'Updated Frontend Team' },
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

  it('allows clearing the description with null', async () => {
    await updateTeam('gitzone-platform', 'team-1', 'user-1', {
      description: null,
    });

    expect(mockedTeamUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { description: null },
      }),
    );
  });

  it('returns 404 when the organization does not exist', async () => {
    mockedOrganizationFindUnique.mockResolvedValueOnce(null);

    await expect(
      updateTeam('missing-org', 'team-1', 'user-1', { name: 'Updated' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mockedTeamFindFirst).not.toHaveBeenCalled();
    expect(mockedTeamUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['a regular member', { role: 'MEMBER' }],
    ['a non-member', null],
  ])('rejects updates by %s', async (_description, membership) => {
    mockedOrganizationMemberFindUnique.mockResolvedValueOnce(membership);

    await expect(
      updateTeam('gitzone-platform', 'team-1', 'user-1', { name: 'Updated' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mockedTeamFindFirst).not.toHaveBeenCalled();
    expect(mockedTeamUpdate).not.toHaveBeenCalled();
  });

  it('does not update a team outside the selected organization', async () => {
    mockedTeamFindFirst.mockResolvedValueOnce(null);

    await expect(
      updateTeam('gitzone-platform', 'foreign-team', 'user-1', { name: 'Updated' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'TEAM_NOT_FOUND',
    });

    expect(mockedTeamUpdate).not.toHaveBeenCalled();
  });

  it('maps duplicate name or slug errors to 409', async () => {
    mockedTeamUpdate.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(
      updateTeam('gitzone-platform', 'team-1', 'user-1', { name: 'Taken' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'TEAM_ALREADY_EXISTS',
    });
  });

  it('maps a missing record during update to 404', async () => {
    mockedTeamUpdate.mockRejectedValueOnce(
      Object.assign(new Error('Record not found'), { code: 'P2025' }),
    );

    await expect(
      updateTeam('gitzone-platform', 'team-1', 'user-1', { name: 'Updated' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'TEAM_NOT_FOUND',
    });
  });

  it('propagates unexpected database errors', async () => {
    const error = new Error('Database connection failed');
    mockedTeamUpdate.mockRejectedValueOnce(error);

    await expect(
      updateTeam('gitzone-platform', 'team-1', 'user-1', { name: 'Updated' }),
    ).rejects.toBe(error);
  });
});