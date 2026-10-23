import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedCreateTeam } = vi.hoisted(() => ({
  mockedCreateTeam: vi.fn(),
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

vi.mock('../../../src/services/organizations/team.service.js', () => ({
  createTeam: mockedCreateTeam,
}));

const { default: app } = await import('../../../src/app.js');
const { AppError } = await import('../../../src/errors/app.error.js');

const endpoint = '/api/organizations/gitzone/teams';

const team = {
  id: 'team-1',
  organizationId: 'org-1',
  name: 'Frontend Team',
  slug: 'frontend-team',
  description: 'Frontend development team',
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
};

describe('POST /api/organizations/:slug/teams', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post(endpoint)
      .send({ name: 'Frontend Team', slug: 'frontend-team' })
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(mockedCreateTeam).not.toHaveBeenCalled();
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app)
      .post('/api/organizations/INVALID_SLUG/teams')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Frontend Team', slug: 'frontend-team' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mockedCreateTeam).not.toHaveBeenCalled();
  });

  it('rejects invalid team data', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({
        name: '   ',
        slug: 'INVALID_SLUG',
      })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_TEAM_DATA');
    expect(mockedCreateTeam).not.toHaveBeenCalled();
  });

  it('rejects unexpected fields in team data', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'Frontend Team',
        slug: 'frontend-team',
        isOwner: true,
      })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_TEAM_DATA');
    expect(mockedCreateTeam).not.toHaveBeenCalled();
  });

  it('creates a team for an authenticated organization owner', async () => {
    mockedCreateTeam.mockResolvedValue(team);

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'Frontend Team',
        slug: 'frontend-team',
        description: 'Frontend development team',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        team: {
          id: 'team-1',
          organizationId: 'org-1',
          name: 'Frontend Team',
          slug: 'frontend-team',
        },
      },
    });

    expect(mockedCreateTeam).toHaveBeenCalledWith('gitzone', 'user-1', {
      name: 'Frontend Team',
      slug: 'frontend-team',
      description: 'Frontend development team',
    });
  });

  it('returns 403 when the actor is not an organization owner', async () => {
    mockedCreateTeam.mockRejectedValue(
      new AppError(
        'Organization owner permission required',
        403,
        'ORGANIZATION_OWNER_REQUIRED',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Frontend Team', slug: 'frontend-team' })
      .expect(403);

    expect(response.body.error.code).toBe('ORGANIZATION_OWNER_REQUIRED');
  });

  it('returns 404 when the organization does not exist', async () => {
    mockedCreateTeam.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Frontend Team', slug: 'frontend-team' })
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('returns 409 for a duplicate team name or slug', async () => {
    mockedCreateTeam.mockRejectedValue(
      new AppError(
        'A team with this name or slug already exists in the organization',
        409,
        'TEAM_ALREADY_EXISTS',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Frontend Team', slug: 'frontend-team' })
      .expect(409);

    expect(response.body.error.code).toBe('TEAM_ALREADY_EXISTS');
  });
});