import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedListOrganizationOwners } = vi.hoisted(() => ({
  mockedListOrganizationOwners: vi.fn(),
}));

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/optional-auth.middleware.js', () => ({
  optionalAuthMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization === 'Bearer member-token') {
      (req as Request & { userId?: string }).userId = 'member-1';
    }

    if (req.headers.authorization === 'Bearer outsider-token') {
      (req as Request & { userId?: string }).userId = 'outsider-1';
    }

    next();
  },
}));

vi.mock('../../../src/services/organizations/organization.service.js', () => ({
  listOrganizationOwners: mockedListOrganizationOwners,
}));

const { AppError } = await import('../../../src/errors/app.error.js');
const { default: app } = await import('../../../src/app.js');

const owners = [
  {
    id: 'user-1',
    username: 'owner1',
    name: 'Owner One',
    avatarUrl: null,
  },
];

describe('GET /api/organizations/:slug/owners', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedListOrganizationOwners.mockResolvedValue(owners);
  });

  it('returns owners for a public organization without authentication', async () => {
    const response = await request(app).get('/api/organizations/public-org/owners').expect(200);

    expect(response.body).toEqual({
      success: true,
      data: { owners },
    });

    expect(mockedListOrganizationOwners).toHaveBeenCalledWith('public-org', undefined);
  });

  it('passes authenticated member identity to the service', async () => {
    await request(app)
      .get('/api/organizations/private-org/owners')
      .set('Authorization', 'Bearer member-token')
      .expect(200);

    expect(mockedListOrganizationOwners).toHaveBeenCalledWith('private-org', 'member-1');
  });

  it('returns 404 for a private organization requested by a guest', async () => {
    mockedListOrganizationOwners.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app).get('/api/organizations/private-org/owners').expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    expect(mockedListOrganizationOwners).toHaveBeenCalledWith('private-org', undefined);
  });

  it('returns 404 for a private organization requested by an outsider', async () => {
    mockedListOrganizationOwners.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app)
      .get('/api/organizations/private-org/owners')
      .set('Authorization', 'Bearer outsider-token')
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    expect(mockedListOrganizationOwners).toHaveBeenCalledWith('private-org', 'outsider-1');
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app).get('/api/organizations/INVALID_SLUG/owners').expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mockedListOrganizationOwners).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown organization', async () => {
    mockedListOrganizationOwners.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app).get('/api/organizations/missing-org/owners').expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });
});
