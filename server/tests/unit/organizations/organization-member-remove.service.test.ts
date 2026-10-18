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

const { removeOrganizationMember } =
  await import('../../../src/services/organizations/organization.service.js');

const slug = 'gitzone-team';
const actorId = 'owner-1';
const targetUserId = 'member-1';

describe('Remove organization member service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.organizationFindUnique.mockResolvedValue({
      id: 'org-1',
    });

    mocks.memberFindUnique
      .mockResolvedValueOnce({ role: 'OWNER' })
      .mockResolvedValueOnce({ role: 'MEMBER' });

    mocks.memberDeleteMany.mockResolvedValue({ count: 1 });
  });

  it('removes a MEMBER when requested by an OWNER', async () => {
    await expect(removeOrganizationMember(slug, actorId, targetUserId)).resolves.toEqual({
      organizationId: 'org-1',
      removedUserId: targetUserId,
    });

    expect(mocks.organizationFindUnique).toHaveBeenCalledWith({
      where: { slug },
      select: { id: true },
    });

    expect(mocks.memberFindUnique).toHaveBeenNthCalledWith(1, {
      where: {
        organizationId_userId: {
          organizationId: 'org-1',
          userId: actorId,
        },
      },
      select: { role: true },
    });

    expect(mocks.memberFindUnique).toHaveBeenNthCalledWith(2, {
      where: {
        organizationId_userId: {
          organizationId: 'org-1',
          userId: targetUserId,
        },
      },
      select: { role: true },
    });

    expect(mocks.memberDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        organizationId: 'org-1',
        userId: targetUserId,
        role: 'MEMBER',
      },
    });
  });

  it('returns 404 when organization does not exist', async () => {
    mocks.organizationFindUnique.mockResolvedValue(null);

    await expect(removeOrganizationMember(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mocks.memberFindUnique).not.toHaveBeenCalled();
    expect(mocks.memberDeleteMany).not.toHaveBeenCalled();
  });

  it('rejects a non-member actor', async () => {
    mocks.memberFindUnique.mockReset();
    mocks.memberFindUnique.mockResolvedValue(null);

    await expect(removeOrganizationMember(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mocks.memberDeleteMany).not.toHaveBeenCalled();
  });

  it('rejects an actor with MEMBER role', async () => {
    mocks.memberFindUnique.mockReset();
    mocks.memberFindUnique.mockResolvedValue({ role: 'MEMBER' });

    await expect(removeOrganizationMember(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mocks.memberDeleteMany).not.toHaveBeenCalled();
  });

  it('returns 404 when target membership does not exist', async () => {
    mocks.memberFindUnique.mockReset();
    mocks.memberFindUnique.mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce(null);

    await expect(removeOrganizationMember(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_MEMBER_NOT_FOUND',
    });

    expect(mocks.memberDeleteMany).not.toHaveBeenCalled();
  });

  it('prevents removing an OWNER', async () => {
    mocks.memberFindUnique.mockReset();
    mocks.memberFindUnique
      .mockResolvedValueOnce({ role: 'OWNER' })
      .mockResolvedValueOnce({ role: 'OWNER' });

    await expect(removeOrganizationMember(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_OWNER_REMOVAL_FORBIDDEN',
    });

    expect(mocks.memberDeleteMany).not.toHaveBeenCalled();
  });

  it('detects membership changes before deletion', async () => {
    mocks.memberDeleteMany.mockResolvedValue({ count: 0 });

    await expect(removeOrganizationMember(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_MEMBERSHIP_CHANGED',
    });

    expect(mocks.memberDeleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        userId: targetUserId,
        role: 'MEMBER',
      },
    });
  });

  it('propagates database errors', async () => {
    const error = new Error('Database unavailable');
    mocks.memberDeleteMany.mockRejectedValue(error);

    await expect(removeOrganizationMember(slug, actorId, targetUserId)).rejects.toBe(error);
  });
});
