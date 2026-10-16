import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/errors/app.error.js';

const mocks = vi.hoisted(() => ({
  leaveOrganization: vi.fn(),
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

    (req as Request & { userId: string }).userId = 'member-1';
    next();
  },
}));

vi.mock('../../../src/services/organizations/organization.service.js', () => ({
  leaveOrganization: mocks.leaveOrganization,
}));

const { default: app } = await import('../../../src/app.js');

const endpoint = '/api/organizations/gitzone-team/leave';
const authorization = 'Bearer test-token';

describe('POST /api/organizations/:slug/leave', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    const response = await request(app).post(endpoint).expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(mocks.leaveOrganization).not.toHaveBeenCalled();
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app)
      .post('/api/organizations/INVALID_SLUG/leave')
      .set('Authorization', authorization)
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mocks.leaveOrganization).not.toHaveBeenCalled();
  });

  it('allows an authenticated MEMBER to leave', async () => {
    mocks.leaveOrganization.mockResolvedValue({
      organizationId: 'org-1',
      leftUserId: 'member-1',
    });

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        organizationId: 'org-1',
        leftUserId: 'member-1',
      },
    });

    expect(mocks.leaveOrganization).toHaveBeenCalledExactlyOnceWith('gitzone-team', 'member-1');
  });

  it('returns 404 when organization does not exist', async () => {
    mocks.leaveOrganization.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('returns 404 when the actor is not a member', async () => {
    mocks.leaveOrganization.mockRejectedValue(
      new AppError('Organization membership not found', 404, 'ORGANIZATION_MEMBER_NOT_FOUND'),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_MEMBER_NOT_FOUND');
  });

  it('prevents an OWNER from leaving', async () => {
    mocks.leaveOrganization.mockRejectedValue(
      new AppError(
        'Organization owners cannot leave through this endpoint',
        409,
        'ORGANIZATION_OWNER_LEAVE_FORBIDDEN',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(409);

    expect(response.body.error.code).toBe('ORGANIZATION_OWNER_LEAVE_FORBIDDEN');
  });

  it('returns 409 when membership changes during leave', async () => {
    mocks.leaveOrganization.mockRejectedValue(
      new AppError(
        'Organization membership changed during leave',
        409,
        'ORGANIZATION_MEMBERSHIP_CHANGED',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .expect(409);

    expect(response.body.error.code).toBe('ORGANIZATION_MEMBERSHIP_CHANGED');
  });
});
