import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockedCreateRepository } = vi.hoisted(() => ({
  mockedCreateRepository: vi.fn(),
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

vi.mock('../../../src/services/repositories/organization-repository-create.service.js', () => ({
  createOrganizationRepository: mockedCreateRepository,
}));

const { default: app } = await import('../../../src/app.js');
const { AppError } = await import('../../../src/errors/app.error.js');

const endpoint = '/api/organizations/gitzone/repositories';

const repository = {
  id: 'repo-1',
  ownerId: null,
  organizationId: 'org-1',
  name: 'demo',
  description: null,
  isPrivate: false,
  defaultBranch: 'main',
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
};

describe('POST /api/organizations/:slug/repositories', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires authentication', async () => {
    const response = await request(app).post(endpoint).send({ name: 'demo' }).expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(mockedCreateRepository).not.toHaveBeenCalled();
  });

  it('rejects an invalid organization slug', async () => {
    const response = await request(app)
      .post('/api/organizations/INVALID_SLUG/repositories')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'demo' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_ORGANIZATION_SLUG');
    expect(mockedCreateRepository).not.toHaveBeenCalled();
  });

  it('rejects invalid repository data', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: '../unsafe' })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_REPOSITORY_DATA');
    expect(mockedCreateRepository).not.toHaveBeenCalled();
  });

  it('creates an organization repository', async () => {
    mockedCreateRepository.mockResolvedValue(repository);

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'demo',
        description: 'Organization repository',
        isPrivate: true,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        repository: {
          id: 'repo-1',
          ownerId: null,
          organizationId: 'org-1',
          name: 'demo',
        },
      },
    });

    expect(mockedCreateRepository).toHaveBeenCalledWith('gitzone', 'user-1', {
      name: 'demo',
      description: 'Organization repository',
      isPrivate: true,
    });
  });

  it('returns 403 when the actor is not an organization OWNER', async () => {
    mockedCreateRepository.mockRejectedValue(
      new AppError('Organization owner permission required', 403, 'ORGANIZATION_OWNER_REQUIRED'),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'demo' })
      .expect(403);

    expect(response.body.error.code).toBe('ORGANIZATION_OWNER_REQUIRED');
  });

  it('returns 404 for an unknown organization', async () => {
    mockedCreateRepository.mockRejectedValue(
      new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND'),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'demo' })
      .expect(404);

    expect(response.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('returns 409 for a duplicate repository', async () => {
    mockedCreateRepository.mockRejectedValue(
      new AppError('Repository with this name already exists', 409, 'REPOSITORY_ALREADY_EXISTS'),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'demo' })
      .expect(409);

    expect(response.body.error.code).toBe('REPOSITORY_ALREADY_EXISTS');
  });

  it('returns 500 when database rollback fails', async () => {
    mockedCreateRepository.mockRejectedValue(
      new AppError(
        'Organization repository creation rollback failed',
        500,
        'ORGANIZATION_REPOSITORY_CREATE_ROLLBACK_FAILED',
      ),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'demo' })
      .expect(500);

    expect(response.body.error.code).toBe('ORGANIZATION_REPOSITORY_CREATE_ROLLBACK_FAILED');
  });
});
