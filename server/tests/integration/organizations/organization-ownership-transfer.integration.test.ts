import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/errors/app.error.js';

const mocks = vi.hoisted(() => ({
  transferOrganizationOwnership: vi.fn(),
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
  transferOrganizationOwnership: mocks.transferOrganizationOwnership,
}));

const { default: app } = await import('../../../src/app.js');

const endpoint = '/api/organizations/gitzone-team/ownership/transfer';
const authorization = 'Bearer test-token';
const validBody = { targetUserId: 'member-1' };

describe('POST /api/organizations/:slug/ownership/transfer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    const response = await request(app).post(endpoint).send(validBody).expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(mocks.transferOrganizationOwnership).not.toHaveBeenCalled();
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app)
      .post('/api/organizations/INVALID_SLUG/ownership/transfer')
      .set('Authorization', authorization)
      .send(validBody)
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mocks.transferOrganizationOwnership).not.toHaveBeenCalled();
  });

  it.each([
    ['missing targetUserId', {}],
    ['empty targetUserId', { targetUserId: '' }],
    ['invalid targetUserId', { targetUserId: 'invalid user!' }],
    ['oversized targetUserId', { targetUserId: 'a'.repeat(129) }],
    ['unexpected body property', { targetUserId: 'member-1', role: 'OWNER' }],
  ])('rejects %s', async (_name, body) => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .send(body)
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_OWNERSHIP_TRANSFER');

    expect(mocks.transferOrganizationOwnership).not.toHaveBeenCalled();
  });

  it('transfers ownership successfully', async () => {
    mocks.transferOrganizationOwnership.mockResolvedValue({
      organizationId: 'org-1',
      previousOwnerId: 'owner-1',
      newOwnerId: 'member-1',
    });

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .send(validBody)
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        organizationId: 'org-1',
        previousOwnerId: 'owner-1',
        newOwnerId: 'member-1',
      },
    });

    expect(mocks.transferOrganizationOwnership).toHaveBeenCalledExactlyOnceWith(
      'gitzone-team',
      'owner-1',
      'member-1',
    );
  });

  it.each([
    [
      400,
      'ORGANIZATION_OWNERSHIP_SELF_TRANSFER',
      'Cannot transfer organization ownership to yourself',
    ],
    [404, 'ORGANIZATION_NOT_FOUND', 'Organization not found'],
    [403, 'ORGANIZATION_OWNER_REQUIRED', 'Organization owner permission required'],
    [404, 'ORGANIZATION_MEMBER_NOT_FOUND', 'Organization member not found'],
    [409, 'ORGANIZATION_OWNERSHIP_TARGET_NOT_MEMBER', 'Target user must be an organization member'],
    [409, 'ORGANIZATION_MEMBERSHIP_CHANGED', 'Organization membership changed during transfer'],
    [409, 'ORGANIZATION_OWNERSHIP_CONFLICT', 'Concurrent organization ownership change detected'],
  ])('returns HTTP %i for %s', async (status, code, message) => {
    mocks.transferOrganizationOwnership.mockRejectedValue(new AppError(message, status, code));

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', authorization)
      .send(validBody)
      .expect(status);

    expect(response.body.error.code).toBe(code);

    expect(mocks.transferOrganizationOwnership).toHaveBeenCalledExactlyOnceWith(
      'gitzone-team',
      'owner-1',
      'member-1',
    );
  });
});
