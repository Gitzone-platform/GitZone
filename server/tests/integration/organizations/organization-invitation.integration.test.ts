import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedInviteOrganizationMember } = vi.hoisted(() => ({
  mockedInviteOrganizationMember: vi.fn(),
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

    (req as Request & { userId: string }).userId = 'owner-1';
    next();
  },
}));

vi.mock('../../../src/services/organizations/organization-invitation.service.js', () => ({
  inviteOrganizationMember: mockedInviteOrganizationMember,
}));

const { default: app } = await import('../../../src/app.js');

const endpoint = '/api/organizations/gitzone-team/invitations';

describe('POST /api/organizations/:slug/invitations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post(endpoint)
      .send({ username: 'developer' })
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(mockedInviteOrganizationMember).not.toHaveBeenCalled();
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app)
      .post('/api/organizations/INVALID_SLUG/invitations')
      .set('Authorization', 'Bearer test-token')
      .send({ username: 'developer' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mockedInviteOrganizationMember).not.toHaveBeenCalled();
  });

  it('rejects an invalid username', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ username: 'a!' })
      .expect(400);

    expect(response.body.error.code).toBe(
      'INVALID_ORGANIZATION_INVITATION_DATA',
    );
    expect(mockedInviteOrganizationMember).not.toHaveBeenCalled();
  });

  it('rejects unexpected input fields', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({
        username: 'developer',
        role: 'OWNER',
      })
      .expect(400);

    expect(response.body.error.code).toBe(
      'INVALID_ORGANIZATION_INVITATION_DATA',
    );
    expect(mockedInviteOrganizationMember).not.toHaveBeenCalled();
  });

  it('creates an invitation for an authenticated owner', async () => {
    mockedInviteOrganizationMember.mockResolvedValue({
      id: 'invitation-1',
      organizationId: 'org-1',
      inviteeId: 'developer-1',
      status: 'PENDING',
      invitee: {
        id: 'developer-1',
        username: 'developer',
      },
    });

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ username: 'developer' })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        invitation: {
          id: 'invitation-1',
          status: 'PENDING',
          invitee: {
            username: 'developer',
          },
        },
      },
    });

    expect(mockedInviteOrganizationMember).toHaveBeenCalledWith(
      'gitzone-team',
      'owner-1',
      { username: 'developer' },
    );
  });

  it('returns HTTP 403 when the user is not an owner', async () => {
    const { AppError } = await import('../../../src/errors/app.error.js');

    mockedInviteOrganizationMember.mockRejectedValue(
      new AppError(
        'Organization owner permission required',
        403,
        'ORGANIZATION_OWNER_REQUIRED',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ username: 'developer' })
      .expect(403);

    expect(response.body.error.code).toBe('ORGANIZATION_OWNER_REQUIRED');
  });

  it('returns HTTP 409 for an existing pending invitation', async () => {
    const { AppError } = await import('../../../src/errors/app.error.js');

    mockedInviteOrganizationMember.mockRejectedValue(
      new AppError(
        'A pending invitation already exists',
        409,
        'ORGANIZATION_INVITATION_ALREADY_EXISTS',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ username: 'developer' })
      .expect(409);

    expect(response.body.error.code).toBe(
      'ORGANIZATION_INVITATION_ALREADY_EXISTS',
    );
  });

  it('returns HTTP 404 for a missing organization', async () => {
    const { AppError } = await import('../../../src/errors/app.error.js');

    mockedInviteOrganizationMember.mockRejectedValue(
      new AppError(
        'Organization not found',
        404,
        'ORGANIZATION_NOT_FOUND',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ username: 'developer' })
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });
});
