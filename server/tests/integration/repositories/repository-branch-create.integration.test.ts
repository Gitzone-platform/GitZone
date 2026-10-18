import type { NextFunction, Request, Response } from 'express';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { createGitBranch } from '../../../src/services/git/git-branch-mutation.service.js';
import { authorizeRepositoryBranchWrite } from '../../../src/services/repositories/repository-branch-access.service.js';

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

    (
      req as Request & {
        userId: string;
      }
    ).userId = 'writer-1';

    next();
  },
}));

vi.mock('../../../src/services/repositories/repository-branch-access.service.js', () => ({
  authorizeRepositoryBranchWrite: vi.fn(),
}));

vi.mock('../../../src/services/git/git-branch-mutation.service.js', () => ({
  createGitBranch: vi.fn(),
}));

const mockedAuthorize = vi.mocked(authorizeRepositoryBranchWrite);

const mockedCreateBranch = vi.mocked(createGitBranch);

const writeAccess = {
  repositoryId: 'repo-1',
  repositoryName: 'demo',
  repositoryOwnerId: 'owner-1',
  repositoryOwnerUsername: 'asil',
  isPrivate: false,
  permission: 'WRITE',
} as const;

const createdBranch = {
  name: 'feature/login',
  fullName: 'refs/heads/feature/login',
  oid: '1111111111111111111111111111111111111111',
  objectType: 'commit' as const,
  isDefault: false,
};

describe('repository branch creation API', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedAuthorize.mockResolvedValue(writeAccess);

    mockedCreateBranch.mockResolvedValue(createdBranch);
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/git/branches')
      .send({
        name: 'feature/login',
      })
      .expect(401);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
      },
    });

    expect(mockedAuthorize).not.toHaveBeenCalled();

    expect(mockedCreateBranch).not.toHaveBeenCalled();
  });

  it('creates a branch for an authorized writer', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/login',
      })
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      data: {
        branch: createdBranch,
      },
    });

    expect(mockedAuthorize).toHaveBeenCalledWith('asil', 'demo', 'writer-1');

    expect(mockedCreateBranch).toHaveBeenCalledWith({
      username: 'asil',
      repositoryName: 'demo',
      branchName: 'feature/login',
    });
  });

  it('creates a branch from an explicit source branch', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/api',
        from: 'develop',
      })
      .expect(201);

    expect(mockedCreateBranch).toHaveBeenCalledWith({
      username: 'asil',
      repositoryName: 'demo',
      branchName: 'feature/api',
      from: 'develop',
    });
  });

  it('rejects an invalid branch name', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: '../main',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_GIT_BRANCH_REQUEST',
      },
    });

    expect(mockedAuthorize).not.toHaveBeenCalled();

    expect(mockedCreateBranch).not.toHaveBeenCalled();
  });

  it('rejects unexpected request properties', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/login',
        unexpected: true,
      })
      .expect(400);

    expect(mockedAuthorize).not.toHaveBeenCalled();

    expect(mockedCreateBranch).not.toHaveBeenCalled();
  });

  it('does not create when WRITE authorization fails', async () => {
    mockedAuthorize.mockRejectedValue(
      new AppError(
        'You do not have permission to access this repository',
        403,
        'REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .post('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/login',
      })
      .expect(403);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_ACCESS_DENIED',
      },
    });

    expect(mockedCreateBranch).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing repository', async () => {
    mockedAuthorize.mockRejectedValue(
      new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND'),
    );

    const response = await request(app)
      .post('/api/repositories/asil/missing/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/login',
      })
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_NOT_FOUND',
      },
    });

    expect(mockedCreateBranch).not.toHaveBeenCalled();
  });

  it('returns a concurrent branch conflict safely', async () => {
    mockedCreateBranch.mockRejectedValue(
      new AppError('Git branch creation conflict', 409, 'GIT_BRANCH_CONFLICT'),
    );

    const response = await request(app)
      .post('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/race',
      })
      .expect(409);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'GIT_BRANCH_CONFLICT',
      },
    });
  });

  it('returns a duplicate branch conflict safely', async () => {
    mockedCreateBranch.mockRejectedValue(
      new AppError('Git branch already exists', 409, 'GIT_BRANCH_ALREADY_EXISTS'),
    );

    const response = await request(app)
      .post('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'develop',
      })
      .expect(409);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'GIT_BRANCH_ALREADY_EXISTS',
      },
    });
  });
});
