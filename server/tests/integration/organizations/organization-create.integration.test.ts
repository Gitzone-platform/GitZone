import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedCreateOrganization } = vi.hoisted(() => ({
  mockedCreateOrganization: vi.fn(),
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

    (req as Request & { userId: string }).userId = 'user-1';
    next();
  },
}));

vi.mock('../../../src/services/organizations/organization.service.js', () => ({
  createOrganization: mockedCreateOrganization,
}));

const { default: app } = await import('../../../src/app.js');

describe('POST /api/organizations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/organizations')
      .send({
        slug: 'gitzone-platform',
        name: 'GitZone',
      })
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(mockedCreateOrganization).not.toHaveBeenCalled();
  });

  it('rejects invalid organization data', async () => {
    const response = await request(app)
      .post('/api/organizations')
      .set('Authorization', 'Bearer test-token')
      .send({
        slug: 'INVALID_SLUG',
        name: 'GitZone',
      })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_DATA');
    expect(mockedCreateOrganization).not.toHaveBeenCalled();
  });

  it('creates an organization for an authenticated user', async () => {
    mockedCreateOrganization.mockResolvedValue({
      id: 'org-1',
      slug: 'gitzone-platform',
      name: 'GitZone',
      description: null,
      visibility: 'PUBLIC',
    });

    const response = await request(app)
      .post('/api/organizations')
      .set('Authorization', 'Bearer test-token')
      .send({
        slug: 'gitzone-platform',
        name: 'GitZone',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        organization: {
          id: 'org-1',
          slug: 'gitzone-platform',
        },
      },
    });

    expect(mockedCreateOrganization).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        slug: 'gitzone-platform',
        visibility: 'PUBLIC',
      }),
    );
  });

  it('returns HTTP 409 for an existing organization slug', async () => {
    const { AppError } = await import('../../../src/errors/app.error.js');

    mockedCreateOrganization.mockRejectedValue(
      new AppError('Organization slug already exists', 409, 'ORGANIZATION_ALREADY_EXISTS'),
    );

    const response = await request(app)
      .post('/api/organizations')
      .set('Authorization', 'Bearer test-token')
      .send({
        slug: 'gitzone-platform',
        name: 'GitZone',
      })
      .expect(409);

    expect(response.body.error.code).toBe('ORGANIZATION_ALREADY_EXISTS');
  });
});
