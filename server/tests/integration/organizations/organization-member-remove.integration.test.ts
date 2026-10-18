import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/errors/app.error.js';

const mocks = vi.hoisted(() => ({
  removeOrganizationMember: vi.fn(),
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

vi.mock('../../../src/services/organizations/organization.service.js', () => ({
  removeOrganizationMember: mocks.removeOrganizationMember,
}));

const { default: app } = await import('../../../src/app.js');

const endpoint = '/api/organizations/gitzone-team/members/member-1';
const authorization = 'Bearer test-token';

describe('DELETE /api/organizations/:slug/members/:userId', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    const response = await request(app).delete(endpoint).expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app)
      .delete('/api/organizations/INVALID_SLUG/members/member-1')
      .set('Authorization', authorization)
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it('rejects an invalid member ID', async () => {
    const response = await request(app)
      .delete('/api/organizations/gitzone-team/members/invalid!id')
      .set('Authorization', authorization)
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_MEMBER_ID');

    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it('rejects an excessively long member ID', async () => {
    const response = await request(app)
      .delete(`/api/organizations/gitzone-team/members/${'a'.repeat(129)}`)
      .set('Authorization', authorization)
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_MEMBER_ID');

    expect(mocks.removeOrganizationMember).not.toHaveBeenCalled();
  });

  it('removes a member for an authenticated owner', async () => {
    mocks.removeOrganizationMember.mockResolvedValue({
      organizationId: 'org-1',
      removedUserId: 'member-1',
    });

    const response = await request(app)
      .delete(endpoint)
      .set('Authorization', authorization)
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        organizationId: 'org-1',
        removedUserId: 'member-1',
      },
    });

    expect(mocks.removeOrganizationMember).toHaveBeenCalledExactlyOnceWith(
      'gitzone-team',
      'owner-1',
      'member-1',
    );
  });

  it('returns 403 when the actor is not an owner', async () => {
    mocks.removeOrganizationMember.mockRejectedValue(
      new AppError('Organization owner permission required', 403, 'ORGANIZATION_OWNER_REQUIRED'),
    );

    const response = await request(app)
      .delete(endpoint)
      .set('Authorization', authorization)
      .expect(403);

    expect(response.body.error.code).toBe('ORGANIZATION_OWNER_REQUIRED');
  });

  it('returns 404 when the organization does not exist', async () => {
    mocks.removeOrganizationMember.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app)
      .delete(endpoint)
      .set('Authorization', authorization)
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('returns 404 when the target membership does not exist', async () => {
    mocks.removeOrganizationMember.mockRejectedValue(
      new AppError('Organization member not found', 404, 'ORGANIZATION_MEMBER_NOT_FOUND'),
    );

    const response = await request(app)
      .delete(endpoint)
      .set('Authorization', authorization)
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_MEMBER_NOT_FOUND');
  });

  it('returns 409 when trying to remove an owner', async () => {
    mocks.removeOrganizationMember.mockRejectedValue(
      new AppError(
        'Organization owners cannot be removed through this endpoint',
        409,
        'ORGANIZATION_OWNER_REMOVAL_FORBIDDEN',
      ),
    );

    const response = await request(app)
      .delete(endpoint)
      .set('Authorization', authorization)
      .expect(409);

    expect(response.body.error.code).toBe('ORGANIZATION_OWNER_REMOVAL_FORBIDDEN');
  });

  it('returns 409 when membership changes during removal', async () => {
    mocks.removeOrganizationMember.mockRejectedValue(
      new AppError(
        'Organization membership changed during removal',
        409,
        'ORGANIZATION_MEMBERSHIP_CHANGED',
      ),
    );

    const response = await request(app)
      .delete(endpoint)
      .set('Authorization', authorization)
      .expect(409);

    expect(response.body.error.code).toBe('ORGANIZATION_MEMBERSHIP_CHANGED');
  });
});
