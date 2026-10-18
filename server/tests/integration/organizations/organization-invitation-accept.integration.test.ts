import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/errors/app.error.js';

const mocks = vi.hoisted(() => ({
  acceptOrganizationInvitation: vi.fn(),
  inviteOrganizationMember: vi.fn(),
}));

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/auth.middleware.js', () => ({
  authMiddleware: (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    (req as Request & { userId: string }).userId = 'invitee-1';
    next();
  },
}));

vi.mock('../../../src/services/organizations/organization-invitation.service.js', () => ({
  acceptOrganizationInvitation: mocks.acceptOrganizationInvitation,
  inviteOrganizationMember: mocks.inviteOrganizationMember,
}));

const { default: app } = await import('../../../src/app.js');

const endpoint = '/api/organizations/invitations/invitation-1/accept';
const authorization = 'Bearer test-token';

describe('POST /api/organizations/invitations/:invitationId/accept', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    const response = await request(app).post(endpoint).expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(mocks.acceptOrganizationInvitation).not.toHaveBeenCalled();
  });

  it('rejects an invalid invitation ID', async () => {
    const response = await request(app)
      .post('/api/organizations/invitations/invalid!id/accept')
      .set('Authorization', authorization)
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_INVITATION_ID');

    expect(mocks.acceptOrganizationInvitation).not.toHaveBeenCalled();
  });

  it('rejects an excessively long invitation ID', async () => {
    const response = await request(app)
      .post(`/api/organizations/invitations/${'a'.repeat(129)}/accept`)
      .set('Authorization', authorization)
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_INVITATION_ID');

    expect(mocks.acceptOrganizationInvitation).not.toHaveBeenCalled();
  });

  it('accepts an invitation for the authenticated invitee', async () => {
    const membership = {
      id: 'member-1',
      organizationId: 'org-1',
      userId: 'invitee-1',
      role: 'MEMBER',
      createdAt: '2026-10-15T00:00:00.000Z',
    };

    mocks.acceptOrganizationInvitation.mockResolvedValue({
      invitationId: 'invitation-1',
      status: 'ACCEPTED',
      membership,
    });

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        invitationId: 'invitation-1',
        status: 'ACCEPTED',
        membership,
      },
    });

    expect(mocks.acceptOrganizationInvitation).toHaveBeenCalledExactlyOnceWith(
      'invitation-1',
      'invitee-1',
    );
  });

  it('returns 404 when the invitation is missing or belongs to another user', async () => {
    mocks.acceptOrganizationInvitation.mockRejectedValue(
      new AppError('Organization invitation not found', 404, 'ORGANIZATION_INVITATION_NOT_FOUND'),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_INVITATION_NOT_FOUND');
  });

  it('returns 409 when the invitation is no longer pending', async () => {
    mocks.acceptOrganizationInvitation.mockRejectedValue(
      new AppError(
        'Organization invitation is no longer pending',
        409,
        'ORGANIZATION_INVITATION_NOT_PENDING',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(409);

    expect(response.body.error.code).toBe('ORGANIZATION_INVITATION_NOT_PENDING');
  });

  it('returns 410 when the invitation has expired', async () => {
    mocks.acceptOrganizationInvitation.mockRejectedValue(
      new AppError('Organization invitation has expired', 410, 'ORGANIZATION_INVITATION_EXPIRED'),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(410);

    expect(response.body.error.code).toBe('ORGANIZATION_INVITATION_EXPIRED');
  });

  it('returns 409 when membership already exists', async () => {
    mocks.acceptOrganizationInvitation.mockRejectedValue(
      new AppError(
        'User is already an organization member',
        409,
        'ORGANIZATION_MEMBER_ALREADY_EXISTS',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(409);

    expect(response.body.error.code).toBe('ORGANIZATION_MEMBER_ALREADY_EXISTS');
  });
});
