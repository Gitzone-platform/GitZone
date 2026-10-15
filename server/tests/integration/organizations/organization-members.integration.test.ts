import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedListOrganizationMembers } = vi.hoisted(() => ({
  mockedListOrganizationMembers: vi.fn(),
}));

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/optional-auth.middleware.js', () => ({
  optionalAuthMiddleware: (
    req: Request,
    _res: Response,
    next: NextFunction,
  ) => {
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
  listOrganizationMembers: mockedListOrganizationMembers,
}));

const { AppError } = await import('../../../src/errors/app.error.js');
const { default: app } = await import('../../../src/app.js');

const members = [
  {
    id: 'user-1',
    username: 'owner1',
    name: 'Owner One',
    avatarUrl: null,
    role: 'OWNER',
    joinedAt: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'user-2',
    username: 'member2',
    name: 'Member Two',
    avatarUrl: null,
    role: 'MEMBER',
    joinedAt: '2026-10-02T10:00:00.000Z',
  },
];

describe('GET /api/organizations/:slug/members', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedListOrganizationMembers.mockResolvedValue(members);
  });

  it('returns members for a public organization without authentication', async () => {
    const response = await request(app)
      .get('/api/organizations/public-org/members')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: { members },
    });

    expect(mockedListOrganizationMembers).toHaveBeenCalledWith(
      'public-org',
      undefined,
    );
  });

  it('passes authenticated member identity to the service', async () => {
    await request(app)
      .get('/api/organizations/private-org/members')
      .set('Authorization', 'Bearer member-token')
      .expect(200);

    expect(mockedListOrganizationMembers).toHaveBeenCalledWith(
      'private-org',
      'member-1',
    );
  });

  it('hides private organization members from guests', async () => {
    mockedListOrganizationMembers.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app)
      .get('/api/organizations/private-org/members')
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    expect(mockedListOrganizationMembers).toHaveBeenCalledWith(
      'private-org',
      undefined,
    );
  });

  it('hides private organization members from outsiders', async () => {
    mockedListOrganizationMembers.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app)
      .get('/api/organizations/private-org/members')
      .set('Authorization', 'Bearer outsider-token')
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');

    expect(mockedListOrganizationMembers).toHaveBeenCalledWith(
      'private-org',
      'outsider-1',
    );
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app)
      .get('/api/organizations/INVALID_SLUG/members')
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mockedListOrganizationMembers).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown organization', async () => {
    mockedListOrganizationMembers.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app)
      .get('/api/organizations/missing-org/members')
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('returns an empty members array when the service returns none', async () => {
    mockedListOrganizationMembers.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/organizations/public-org/members')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: { members: [] },
    });
  });
});