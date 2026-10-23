import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockedOrganizationFindUnique,
  mockedOrganizationMemberFindUnique,
  mockedTeamFindFirst,
  mockedTeamDelete,
} = vi.hoisted(() => ({
  mockedOrganizationFindUnique: vi.fn(),
  mockedOrganizationMemberFindUnique: vi.fn(),
  mockedTeamFindFirst: vi.fn(),
  mockedTeamDelete: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: { findUnique: mockedOrganizationFindUnique },
    organizationMember: { findUnique: mockedOrganizationMemberFindUnique },
    team: {
      findFirst: mockedTeamFindFirst,
      delete: mockedTeamDelete,
    },
  },
}));

const { deleteTeam } = await import(
  '../../../src/services/organizations/team.service.js'
);

describe('Delete team service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedOrganizationFindUnique.mockResolvedValue({ id: 'org-1' });
    mockedOrganizationMemberFindUnique.mockResolvedValue({ role: 'OWNER' });
    mockedTeamFindFirst.mockResolvedValue({ id: 'team-1' });
    mockedTeamDelete.mockResolvedValue({ id: 'team-1' });
  });

  it('deletes a team belonging to the organization for its owner', async () => {
    await expect(
      deleteTeam('gitzone-platform', 'team-1', 'user-1'),
    ).resolves.toEqual({ id: 'team-1' });

    expect(mockedTeamFindFirst).toHaveBeenCalledWith({
      where: { id: 'team-1', organizationId: 'org-1' },
      select: { id: true },
    });
    expect(mockedTeamDelete).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      select: { id: true },
    });
  });

  it('returns 404 when the organization does not exist', async () => {
    mockedOrganizationFindUnique.mockResolvedValueOnce(null);

    await expect(
      deleteTeam('missing-org', 'team-1', 'user-1'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mockedTeamFindFirst).not.toHaveBeenCalled();
    expect(mockedTeamDelete).not.toHaveBeenCalled();
  });

  it('rejects a regular organization member', async () => {
    mockedOrganizationMemberFindUnique.mockResolvedValueOnce({
      role: 'MEMBER',
    });

    await expect(
      deleteTeam('gitzone-platform', 'team-1', 'user-1'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mockedTeamFindFirst).not.toHaveBeenCalled();
    expect(mockedTeamDelete).not.toHaveBeenCalled();
  });

  it('rejects a user who is not an organization member', async () => {
    mockedOrganizationMemberFindUnique.mockResolvedValueOnce(null);

    await expect(
      deleteTeam('gitzone-platform', 'team-1', 'user-1'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mockedTeamDelete).not.toHaveBeenCalled();
  });

  it('does not delete a team belonging to another organization', async () => {
    mockedTeamFindFirst.mockResolvedValueOnce(null);

    await expect(
      deleteTeam('gitzone-platform', 'team-2', 'user-1'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'TEAM_NOT_FOUND',
    });

    expect(mockedTeamFindFirst).toHaveBeenCalledWith({
      where: { id: 'team-2', organizationId: 'org-1' },
      select: { id: true },
    });
    expect(mockedTeamDelete).not.toHaveBeenCalled();
  });

  it('maps Prisma P2025 to TEAM_NOT_FOUND', async () => {
    mockedTeamDelete.mockRejectedValueOnce(
      Object.assign(new Error('Record not found'), { code: 'P2025' }),
    );

    await expect(
      deleteTeam('gitzone-platform', 'team-1', 'user-1'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'TEAM_NOT_FOUND',
    });
  });

  it('propagates unexpected database errors', async () => {
    const error = new Error('Database unavailable');
    mockedTeamDelete.mockRejectedValueOnce(error);

    await expect(
      deleteTeam('gitzone-platform', 'team-1', 'user-1'),
    ).rejects.toBe(error);
  });

  it('propagates organization lookup errors', async () => {
    const error = new Error('Organization query failed');
    mockedOrganizationFindUnique.mockRejectedValueOnce(error);

    await expect(
      deleteTeam('gitzone-platform', 'team-1', 'user-1'),
    ).rejects.toBe(error);

    expect(mockedTeamDelete).not.toHaveBeenCalled();
  });
});
