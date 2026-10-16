import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  memberFindUnique: vi.fn(),
  memberUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: {
      findUnique: mocks.organizationFindUnique,
    },
    organizationMember: {
      findUnique: mocks.memberFindUnique,
      updateMany: mocks.memberUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

const { transferOrganizationOwnership } =
  await import('../../../src/services/organizations/organization.service.js');

const slug = 'gitzone-team';
const actorId = 'owner-1';
const targetUserId = 'member-1';

const tx = {
  organizationMember: {
    findUnique: mocks.memberFindUnique,
    updateMany: mocks.memberUpdateMany,
  },
};

describe('Transfer organization ownership service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.organizationFindUnique.mockResolvedValue({
      id: 'org-1',
    });

    mocks.memberFindUnique.mockImplementation(
      async (args: {
        where: {
          organizationId_userId: {
            userId: string;
          };
        };
      }) => {
        const userId = args.where.organizationId_userId.userId;

        if (userId === actorId) {
          return { role: 'OWNER' };
        }

        if (userId === targetUserId) {
          return { role: 'MEMBER' };
        }

        return null;
      },
    );

    mocks.memberUpdateMany.mockResolvedValue({ count: 1 });

    mocks.transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
  });

  it('atomically promotes the target and demotes the current owner', async () => {
    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).resolves.toEqual({
      organizationId: 'org-1',
      previousOwnerId: actorId,
      newOwnerId: targetUserId,
    });

    expect(mocks.organizationFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { slug },
      select: { id: true },
    });

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: 'Serializable',
    });

    expect(mocks.memberUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        organizationId: 'org-1',
        userId: targetUserId,
        role: 'MEMBER',
      },
      data: { role: 'OWNER' },
    });

    expect(mocks.memberUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        organizationId: 'org-1',
        userId: actorId,
        role: 'OWNER',
      },
      data: { role: 'MEMBER' },
    });
  });

  it('rejects transferring ownership to yourself', async () => {
    await expect(transferOrganizationOwnership(slug, actorId, actorId)).rejects.toMatchObject({
      statusCode: 400,
      code: 'ORGANIZATION_OWNERSHIP_SELF_TRANSFER',
    });

    expect(mocks.organizationFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown organization', async () => {
    mocks.organizationFindUnique.mockResolvedValue(null);

    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('requires the actor to be an OWNER', async () => {
    mocks.memberFindUnique.mockResolvedValue({
      role: 'MEMBER',
    });

    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mocks.memberUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects an actor without membership', async () => {
    mocks.memberFindUnique.mockResolvedValue(null);

    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mocks.memberUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 404 if the target is not a member', async () => {
    mocks.memberFindUnique.mockImplementation(
      async (args: {
        where: {
          organizationId_userId: {
            userId: string;
          };
        };
      }) => (args.where.organizationId_userId.userId === actorId ? { role: 'OWNER' } : null),
    );

    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_MEMBER_NOT_FOUND',
    });

    expect(mocks.memberUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects transferring to an existing OWNER', async () => {
    mocks.memberFindUnique.mockResolvedValue({
      role: 'OWNER',
    });

    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_OWNERSHIP_TARGET_NOT_MEMBER',
    });

    expect(mocks.memberUpdateMany).not.toHaveBeenCalled();
  });

  it('detects target membership changes before promotion', async () => {
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_MEMBERSHIP_CHANGED',
    });

    expect(mocks.memberUpdateMany).toHaveBeenCalledOnce();
  });

  it('rejects the transaction if the current owner changes', async () => {
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_MEMBERSHIP_CHANGED',
    });

    expect(mocks.memberUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('maps a Prisma serialization conflict to HTTP 409', async () => {
    const error = Object.assign(new Error('Transaction conflict'), {
      code: 'P2034',
    });

    mocks.transaction.mockRejectedValue(error);

    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_OWNERSHIP_CONFLICT',
    });
  });

  it('propagates unexpected database errors', async () => {
    const error = new Error('Database unavailable');

    mocks.transaction.mockRejectedValue(error);

    await expect(transferOrganizationOwnership(slug, actorId, targetUserId)).rejects.toBe(error);
  });
});
