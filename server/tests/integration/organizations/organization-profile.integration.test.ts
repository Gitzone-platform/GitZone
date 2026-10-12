import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockedGetProfile,
  mockedUpdateProfile,
} = vi.hoisted(() => ({
  mockedGetProfile: vi.fn(),
  mockedUpdateProfile: vi.fn(),
}));

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/auth.middleware.js', () => ({
  authMiddleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
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

vi.mock('../../../src/middleware/optional-auth.middleware.js', () => ({
  optionalAuthMiddleware: (
    req: Request,
    _res: Response,
    next: NextFunction,
  ) => {
    if (req.headers.authorization) {
      (req as Request & { userId?: string }).userId = 'member-1';
    }

    next();
  },
}));

vi.mock('../../../src/services/organizations/organization.service.js', () => ({
  createOrganization: vi.fn(),
  getOrganizationProfile: mockedGetProfile,
  updateOrganizationProfile: mockedUpdateProfile,
}));

const { default: app } = await import('../../../src/app.js');

const organization = {
  id: 'org-1',
  slug: 'gitzone-platform',
  name: 'GitZone Platform',
  visibility: 'PUBLIC',
};

describe('Organization profile HTTP API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns public organization profiles', async () => {
    mockedGetProfile.mockResolvedValue(organization);

    const response = await request(app)
      .get('/api/organizations/gitzone-platform')
      .expect(200);

    expect(response.body.data.organization).toMatchObject(organization);

    expect(mockedGetProfile).toHaveBeenCalledWith(
      'gitzone-platform',
      undefined,
    );
  });

  it('passes authenticated viewer identity to the service', async () => {
    mockedGetProfile.mockResolvedValue(organization);

    await request(app)
      .get('/api/organizations/gitzone-platform')
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    expect(mockedGetProfile).toHaveBeenCalledWith(
      'gitzone-platform',
      'member-1',
    );
  });

  it('rejects anonymous profile updates', async () => {
    await request(app)
      .patch('/api/organizations/gitzone-platform')
      .send({ name: 'Changed' })
      .expect(401);

    expect(mockedUpdateProfile).not.toHaveBeenCalled();
  });

  it('rejects invalid profile update fields', async () => {
    const response = await request(app)
      .patch('/api/organizations/gitzone-platform')
      .set('Authorization', 'Bearer test-token')
      .send({ visibility: 'PRIVATE' })
      .expect(400);

    expect(response.body.error.code).toBe(
      'INVALID_ORGANIZATION_PROFILE_DATA',
    );

    expect(mockedUpdateProfile).not.toHaveBeenCalled();
  });

  it('updates profiles for authenticated owners', async () => {
    mockedUpdateProfile.mockResolvedValue({
      ...organization,
      name: 'Updated',
    });

    const response = await request(app)
      .patch('/api/organizations/gitzone-platform')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Updated' })
      .expect(200);

    expect(response.body.data.organization.name).toBe('Updated');

    expect(mockedUpdateProfile).toHaveBeenCalledWith(
      'gitzone-platform',
      'owner-1',
      { name: 'Updated' },
    );
  });
});
