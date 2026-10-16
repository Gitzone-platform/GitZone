import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  memberFindUnique: vi.fn(),
  memberDeleteMany: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: {
      findUnique: mocks.organizationFindUnique,
    },
    organizationMember: {
      findUnique: mocks.memberFindUnique,
      deleteMany: mocks.memberDeleteMany,
    },
  },
}));

const { leaveOrganization } =
  await import('../../../src/services/organizations/organization.service.js');

const slug = 'gitzone-team';
const actorId = 'member-1';

describe('Leave organization service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.organizationFindUnique.mockResolvedValue({
      id: 'org-1',
    });

    mocks.memberFindUnique.mockResolvedValue({
      role: 'MEMBER',
    });

    mocks.memberDeleteMany.mockResolvedValue({
      count: 1,
    });
  });

  it('allows a MEMBER to leave the organization', async () => {
    await expect(
      leaveOrganization(slug, actorId),
    ).resolves.toEqual({
      organizationId: 'org-1',
      leftUserId: actorId,
    });

    expect(mocks.organizationFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { slug },
      select: { id: true },
    });

    expect(mocks.memberFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: {
        organizationId_userId: {
          organizationId: 'org-1',
          userId: actorId,
        },
      },
      select: { role: true },
    });

    expect(mocks.memberDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        organizationId: 'org-1',
        userId: actorId,
        role: 'MEMBER',
      },
    });
  });

  it('returns 404 when organization does not exist', async () => {
    mocks.organizationFindUnique.mockResolvedValue(null);

    await expect(
      leaveOrganization(slug, actorId),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mocks.memberFindUnique).not.toHaveBeenCalled();
    expect(mocks.memberDeleteMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the actor is not a member', async () => {
    mocks.memberFindUnique.mockResolvedValue(null);

    await expect(
      leaveOrganization(slug, actorId),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_MEMBER_NOT_FOUND',
    });

    expect(mocks.memberDeleteMany).not.toHaveBeenCalled();
  });

  it('prevents an OWNER from leaving', async () => {
    mocks.memberFindUnique.mockResolvedValue({
      role: 'OWNER',
    });

    await expect(
      leaveOrganization(slug, actorId),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_OWNER_LEAVE_FORBIDDEN',
    });

    expect(mocks.memberDeleteMany).not.toHaveBeenCalled();
  });

  it('detects membership changes during deletion', async () => {
    mocks.memberDeleteMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      leaveOrganization(slug, actorId),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_MEMBERSHIP_CHANGED',
    });

    expect(mocks.memberDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        organizationId: 'org-1',
        userId: actorId,
        role: 'MEMBER',
      },
    });
  });

  it('propagates database errors', async () => {
    const error = new Error('Database unavailable');

    mocks.memberDeleteMany.mockRejectedValue(error);

    await expect(
      leaveOrganization(slug, actorId),
    ).rejects.toBe(error);
  });
});
