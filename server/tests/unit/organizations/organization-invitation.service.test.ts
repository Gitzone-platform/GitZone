import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  memberFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  invitationFindFirst: vi.fn(),
  invitationCreate: vi.fn(),
  invitationUpdate: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    organization: {
      findUnique: mocks.organizationFindUnique,
    },
    organizationMember: {
      findUnique: mocks.memberFindUnique,
    },
    user: {
      findFirst: mocks.userFindFirst,
    },
    organizationInvitation: {
      findFirst: mocks.invitationFindFirst,
      create: mocks.invitationCreate,
      update: mocks.invitationUpdate,
    },
  },
}));

import { inviteOrganizationMember } from '../../../src/services/organizations/organization-invitation.service.js';

const input = { username: 'developer' };

const invitee = {
  id: 'user-2',
  username: 'developer',
  name: 'Developer',
  avatarUrl: null,
};

const invitation = {
  id: 'invitation-1',
  organizationId: 'org-1',
  inviteeId: 'user-2',
  invitedById: 'user-1',
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('inviteOrganizationMember', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.organizationFindUnique.mockResolvedValue({ id: 'org-1' });
    mocks.memberFindUnique
      .mockResolvedValueOnce({ role: 'OWNER' })
      .mockResolvedValueOnce(null);
    mocks.userFindFirst.mockResolvedValue(invitee);
    mocks.invitationFindFirst.mockResolvedValue(null);
    mocks.invitationCreate.mockResolvedValue(invitation);
    mocks.invitationUpdate.mockResolvedValue(invitation);
  });

  it('rejects a missing organization', async () => {
    mocks.organizationFindUnique.mockResolvedValue(null);

    await expect(
      inviteOrganizationMember('missing', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });

  it('requires OWNER membership', async () => {
    mocks.memberFindUnique.mockReset().mockResolvedValue({ role: 'MEMBER' });

    await expect(
      inviteOrganizationMember('team', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ORGANIZATION_OWNER_REQUIRED',
    });

    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  it('rejects an unknown username', async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(
      inviteOrganizationMember('team', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('rejects an existing organization member', async () => {
    mocks.memberFindUnique
      .mockReset()
      .mockResolvedValueOnce({ role: 'OWNER' })
      .mockResolvedValueOnce({ id: 'membership-2' });

    await expect(
      inviteOrganizationMember('team', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_MEMBER_ALREADY_EXISTS',
    });

    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });

  it('rejects an active pending invitation', async () => {
    mocks.invitationFindFirst.mockResolvedValue({
      id: 'invitation-1',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      inviteOrganizationMember('team', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_INVITATION_ALREADY_EXISTS',
    });

    expect(mocks.invitationCreate).not.toHaveBeenCalled();
    expect(mocks.invitationUpdate).not.toHaveBeenCalled();
  });

  it('creates a seven-day invitation', async () => {
    const before = Date.now();

    const result = await inviteOrganizationMember(
      'team',
      'user-1',
      input,
    );

    const after = Date.now();

    expect(result).toMatchObject({
      id: 'invitation-1',
      invitee,
    });

    expect(mocks.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          username: {
            equals: 'developer',
            mode: 'insensitive',
          },
        },
      }),
    );

    const createArgs = mocks.invitationCreate.mock.calls[0]?.[0];

    expect(createArgs.data).toMatchObject({
      organizationId: 'org-1',
      inviteeId: 'user-2',
      invitedById: 'user-1',
      status: 'PENDING',
    });

    const expiry = createArgs.data.expiresAt.getTime();
    const ttl = 7 * 24 * 60 * 60 * 1000;

    expect(expiry).toBeGreaterThanOrEqual(before + ttl);
    expect(expiry).toBeLessThanOrEqual(after + ttl);
  });

  it('renews an expired pending invitation', async () => {
    mocks.invitationFindFirst.mockResolvedValue({
      id: 'invitation-old',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await inviteOrganizationMember(
      'team',
      'user-1',
      input,
    );

    expect(result.invitee).toEqual(invitee);
    expect(mocks.invitationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'invitation-old',
          status: 'PENDING',
        }),
        data: expect.objectContaining({
          invitedById: 'user-1',
        }),
      }),
    );

    expect(mocks.invitationCreate).not.toHaveBeenCalled();
  });

  it('converts concurrent unique violations into HTTP 409', async () => {
    mocks.invitationCreate.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      }),
    );

    await expect(
      inviteOrganizationMember('team', 'user-1', input),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORGANIZATION_INVITATION_ALREADY_EXISTS',
    });
  });
});
