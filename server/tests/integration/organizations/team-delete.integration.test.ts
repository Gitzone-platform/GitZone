import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedDeleteTeam } = vi.hoisted(() => ({
  mockedDeleteTeam: vi.fn(),
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
  updateTeam: vi.fn(),
  deleteTeam: mockedDeleteTeam,
}));

const { default: app } = await import('../../../src/app.js');
const { AppError } = await import('../../../src/errors/app.error.js');

const endpoint = '/api/organizations/gitzone/teams/team-1';

describe('DELETE /api/organizations/:slug/teams/:teamId', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedDeleteTeam.mockResolvedValue({ id: 'team-1' });
  });

  it('requires authentication', async () => {
    await request(app).delete(endpoint).expect(401);
    expect(mockedDeleteTeam).not.toHaveBeenCalled();
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app)
      .delete('/api/organizations/INVALID_SLUG/teams/team-1')
      .set('Authorization', 'Bearer test-token')
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mockedDeleteTeam).not.toHaveBeenCalled();
  });

  it('rejects an invalid team ID', async () => {
    const response = await request(app)
      .delete('/api/organizations/gitzone/teams/%20')
      .set('Authorization', 'Bearer test-token')
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_TEAM_ID');
    expect(mockedDeleteTeam).not.toHaveBeenCalled();
  });

  it('deletes a team and returns its ID', async () => {
    const response = await request(app)
      .delete(endpoint)
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: { team: { id: 'team-1' } },
    });
    expect(mockedDeleteTeam).toHaveBeenCalledWith(
      'gitzone',
      'team-1',
      'user-1',
    );
  });

  it('returns the service error when the actor is not an owner', async () => {
    mockedDeleteTeam.mockRejectedValueOnce(
      new AppError(
        'Organization owner permission required',
        403,
        'ORGANIZATION_OWNER_REQUIRED',
      ),
    );

    const response = await request(app)
      .delete(endpoint)
      .set('Authorization', 'Bearer test-token')
      .expect(403);

    expect(response.body.error.code).toBe('ORGANIZATION_OWNER_REQUIRED');
  });

  it('returns 404 when the team does not exist in the organization', async () => {
    mockedDeleteTeam.mockRejectedValueOnce(
      new AppError('Team not found', 404, 'TEAM_NOT_FOUND'),
    );

    const response = await request(app)
      .delete(endpoint)
      .set('Authorization', 'Bearer test-token')
      .expect(404);

    expect(response.body.error.code).toBe('TEAM_NOT_FOUND');
  });
});
