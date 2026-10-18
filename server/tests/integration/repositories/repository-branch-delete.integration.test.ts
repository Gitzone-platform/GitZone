import type { NextFunction, Request, Response } from 'express';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { deleteGitBranch } from '../../../src/services/git/git-branch-mutation.service.js';
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
  deleteGitBranch: vi.fn(),
}));

const mockedAuthorize = vi.mocked(authorizeRepositoryBranchWrite);

const mockedDelete = vi.mocked(deleteGitBranch);

const writeAccess = {
  repositoryId: 'repo-1',
  repositoryName: 'demo',
  repositoryOwnerId: 'owner-1',
  repositoryOwnerUsername: 'asil',
  isPrivate: false,
  permission: 'WRITE',
} as const;

describe('repository branch deletion API', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedAuthorize.mockResolvedValue(writeAccess);

    mockedDelete.mockResolvedValue(undefined);
  });

  it('requires authentication', async () => {
    await request(app)
      .delete('/api/repositories/asil/demo/git/branches?name=feature%2Flogin')
      .expect(401);

    expect(mockedAuthorize).not.toHaveBeenCalled();

    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('deletes a branch for an authorized writer', async () => {
    await request(app)
      .delete('/api/repositories/asil/demo/git/branches?name=feature%2Flogin')
      .set('Authorization', 'Bearer test-token')
      .expect(204);

    expect(mockedAuthorize).toHaveBeenCalledWith('asil', 'demo', 'writer-1');

    expect(mockedDelete).toHaveBeenCalledWith({
      username: 'asil',
      repositoryName: 'demo',
      branchName: 'feature/login',
    });
  });

  it('rejects an invalid branch name', async () => {
    await request(app)
      .delete('/api/repositories/asil/demo/git/branches?name=..%2Fmain')
      .set('Authorization', 'Bearer test-token')
      .expect(400);

    expect(mockedAuthorize).not.toHaveBeenCalled();

    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('rejects unexpected query properties', async () => {
    await request(app)
      .delete('/api/repositories/asil/demo/git/branches?name=feature&extra=true')
      .set('Authorization', 'Bearer test-token')
      .expect(400);

    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('denies users without WRITE access', async () => {
    mockedAuthorize.mockRejectedValue(
      new AppError(
        'You do not have permission to access this repository',
        403,
        'REPOSITORY_ACCESS_DENIED',
      ),
    );

    await request(app)
      .delete('/api/repositories/asil/demo/git/branches?name=feature')
      .set('Authorization', 'Bearer test-token')
      .expect(403);

    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('protects the default branch', async () => {
    mockedDelete.mockRejectedValue(
      new AppError('Default branch cannot be deleted', 409, 'GIT_DEFAULT_BRANCH_PROTECTED'),
    );

    const response = await request(app)
      .delete('/api/repositories/asil/demo/git/branches?name=main')
      .set('Authorization', 'Bearer test-token')
      .expect(409);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'GIT_DEFAULT_BRANCH_PROTECTED',
      },
    });
  });

  it('returns 404 for a missing branch', async () => {
    mockedDelete.mockRejectedValue(
      new AppError('Git branch not found', 404, 'GIT_BRANCH_NOT_FOUND'),
    );

    await request(app)
      .delete('/api/repositories/asil/demo/git/branches?name=missing')
      .set('Authorization', 'Bearer test-token')
      .expect(404);
  });

  it('returns concurrent deletion conflict safely', async () => {
    mockedDelete.mockRejectedValue(
      new AppError('Git branch deletion conflict', 409, 'GIT_BRANCH_CONFLICT'),
    );

    const response = await request(app)
      .delete('/api/repositories/asil/demo/git/branches?name=feature')
      .set('Authorization', 'Bearer test-token')
      .expect(409);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'GIT_BRANCH_CONFLICT',
      },
    });
  });
});
