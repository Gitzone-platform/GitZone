import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invitationFindUnique: vi.fn(),
  invitationUpdateMany: vi.fn(),
  memberCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organizationInvitation: {
      findUnique: mocks.invitationFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

import { acceptOrganizationInvitation } from '../../../src/services/organizations/organization-invitation.service.js';

const invitation = {
  id: 'invitation-1',
  organizationId: 'org-1',
  inviteeId: 'user-2',
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const membership = {
  id: 'membership-1',
  organizationId: 'org-1',
  userId: 'user-2',
  role: 'MEMBER',
  createdAt: new Date(),
};

describe('acceptOrganizationInvitation', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.invitationFindUnique.mockResolvedValue(invitation);
    mocks.invitationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.memberCreate.mockResolvedValue(membership);

    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        organizationInvitation: {
          updateMany: mocks.invitationUpdateMany,
        },
        organizationMember: {
          create: mocks.memberCreate,
        },
      }),
    );
  });

  it('rejects a missing invitation', async () => {
    mocks.invitationFindUnique.mockResolvedValue(null);

    await expect(acceptOrganizationInvitation('missing', 'user-2')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_INVITATION_NOT_FOUND',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does not expose another user invitation', async () => {
    await expect(acceptOrganizationInvitation('invitation-1', 'other-user')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_INVITATION_NOT_FOUND',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects an already accepted invitation', async () => {
    mocks.invitationFindUnique.mockResolvedValue({
      ...invitation,
      status: 'ACCEPTED',
    });

    await expect(acceptOrganizationInvitation('invitation-1', 'user-2')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_INVITATION_NOT_PENDING',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a revoked invitation', async () => {
    mocks.invitationFindUnique.mockResolvedValue({
      ...invitation,
      status: 'REVOKED',
    });

    await expect(acceptOrganizationInvitation('invitation-1', 'user-2')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_INVITATION_NOT_PENDING',
    });
  });

  it('rejects an expired invitation', async () => {
    mocks.invitationFindUnique.mockResolvedValue({
      ...invitation,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(acceptOrganizationInvitation('invitation-1', 'user-2')).rejects.toMatchObject({
      statusCode: 410,
      code: 'ORGANIZATION_INVITATION_EXPIRED',
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('accepts the invitation and creates MEMBER membership', async () => {
    const result = await acceptOrganizationInvitation('invitation-1', 'user-2');

    expect(result).toEqual({
      invitationId: 'invitation-1',
      status: 'ACCEPTED',
      membership,
    });

    expect(mocks.transaction).toHaveBeenCalledOnce();

    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'invitation-1',
        inviteeId: 'user-2',
        status: 'PENDING',
        expiresAt: {
          gt: expect.any(Date),
        },
      },
      data: {
        status: 'ACCEPTED',
      },
    });

    expect(mocks.memberCreate).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        userId: 'user-2',
        role: 'MEMBER',
      },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        role: true,
        createdAt: true,
      },
    });
  });

  it('rejects an invitation claimed by a concurrent request', async () => {
    mocks.invitationUpdateMany.mockResolvedValue({ count: 0 });

    await expect(acceptOrganizationInvitation('invitation-1', 'user-2')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_INVITATION_NOT_PENDING',
    });

    expect(mocks.memberCreate).not.toHaveBeenCalled();
  });

  it('maps duplicate membership errors to HTTP 409', async () => {
    mocks.memberCreate.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      }),
    );

    await expect(acceptOrganizationInvitation('invitation-1', 'user-2')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_MEMBER_ALREADY_EXISTS',
    });
  });

  it('propagates unexpected database errors', async () => {
    mocks.memberCreate.mockRejectedValue(new Error('Database unavailable'));

    await expect(acceptOrganizationInvitation('invitation-1', 'user-2')).rejects.toThrow(
      'Database unavailable',
    );
  });
});
