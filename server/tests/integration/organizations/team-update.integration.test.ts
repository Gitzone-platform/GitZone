import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedUpdateTeam } = vi.hoisted(() => ({
  mockedUpdateTeam: vi.fn(),
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
  createTeam: vi.fn(),
  updateTeam: mockedUpdateTeam,
}));

const { default: app } = await import('../../../src/app.js');
const { AppError } = await import('../../../src/errors/app.error.js');

const endpoint = '/api/organizations/gitzone/teams/team-1';

const team = {
  id: 'team-1',
  organizationId: 'org-1',
  name: 'Updated Frontend Team',
  slug: 'frontend-team',
  description: 'Frontend development team',
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
};

describe('PATCH /api/organizations/:slug/teams/:teamId', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    await request(app).patch(endpoint).send({ name: 'Updated' }).expect(401);
    expect(mockedUpdateTeam).not.toHaveBeenCalled();
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app)
      .patch('/api/organizations/INVALID_SLUG/teams/team-1')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Updated' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mockedUpdateTeam).not.toHaveBeenCalled();
  });

  it('rejects an invalid team ID', async () => {
    const response = await request(app)
      .patch('/api/organizations/gitzone/teams/%20')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Updated' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_TEAM_ID');
    expect(mockedUpdateTeam).not.toHaveBeenCalled();
  });

  it('rejects an empty update body', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({})
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_TEAM_DATA');
    expect(mockedUpdateTeam).not.toHaveBeenCalled();
  });

  it('rejects invalid fields and unexpected properties', async () => {
    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ slug: 'INVALID_SLUG', isOwner: true })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_TEAM_DATA');
    expect(mockedUpdateTeam).not.toHaveBeenCalled();
  });

  it('updates a team for an authenticated owner', async () => {
    mockedUpdateTeam.mockResolvedValue(team);

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Updated Frontend Team' })
      .expect(200);

    expect(response.body.data.team).toMatchObject({
      id: 'team-1',
      name: 'Updated Frontend Team',
    });
    expect(mockedUpdateTeam).toHaveBeenCalledWith(
      'gitzone',
      'team-1',
      'user-1',
      { name: 'Updated Frontend Team' },
    );
  });

  it('allows clearing the description', async () => {
    mockedUpdateTeam.mockResolvedValue({ ...team, description: null });

    await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ description: null })
      .expect(200);

    expect(mockedUpdateTeam).toHaveBeenCalledWith(
      'gitzone',
      'team-1',
      'user-1',
      { description: null },
    );
  });

  it('returns 403 when the actor is not an organization owner', async () => {
    mockedUpdateTeam.mockRejectedValue(
      new AppError(
        'Organization owner permission required',
        403,
        'ORGANIZATION_OWNER_REQUIRED',
      ),
    );

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Updated' })
      .expect(403);

    expect(response.body.error.code).toBe('ORGANIZATION_OWNER_REQUIRED');
  });

  it('returns 404 when the organization does not exist', async () => {
    mockedUpdateTeam.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Updated' })
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('returns 404 when the team does not belong to the organization', async () => {
    mockedUpdateTeam.mockRejectedValue(
      new AppError('Team not found', 404, 'TEAM_NOT_FOUND'),
    );

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Updated' })
      .expect(404);

    expect(response.body.error.code).toBe('TEAM_NOT_FOUND');
  });

  it('returns 409 when the team name or slug conflicts', async () => {
    mockedUpdateTeam.mockRejectedValue(
      new AppError(
        'A team with this name or slug already exists in the organization',
        409,
        'TEAM_ALREADY_EXISTS',
      ),
    );

    const response = await request(app)
      .patch(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'Taken' })
      .expect(409);

    expect(response.body.error.code).toBe('TEAM_ALREADY_EXISTS');
  });
});