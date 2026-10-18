import type { NextFunction, Request, Response } from 'express';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { renameGitBranch } from '../../../src/services/git/git-branch-mutation.service.js';
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
  renameGitBranch: vi.fn(),
}));

const mockedAuthorize = vi.mocked(authorizeRepositoryBranchWrite);

const mockedRename = vi.mocked(renameGitBranch);

const writeAccess = {
  repositoryId: 'repo-1',
  repositoryName: 'demo',
  repositoryOwnerId: 'owner-1',
  repositoryOwnerUsername: 'asil',
  isPrivate: false,
  permission: 'WRITE',
} as const;

const renamedBranch = {
  name: 'feature/auth',
  fullName: 'refs/heads/feature/auth',
  oid: '2222222222222222222222222222222222222222',
  objectType: 'commit' as const,
};

describe('repository branch rename API', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedAuthorize.mockResolvedValue(writeAccess);

    mockedRename.mockResolvedValue(renamedBranch);
  });

  it('requires authentication', async () => {
    await request(app)
      .patch('/api/repositories/asil/demo/git/branches')
      .send({
        name: 'feature/login',
        newName: 'feature/auth',
      })
      .expect(401);

    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('renames branch for authorized writer', async () => {
    const response = await request(app)
      .patch('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/login',
        newName: 'feature/auth',
      })
      .expect(200);

    expect(mockedAuthorize).toHaveBeenCalledWith('asil', 'demo', 'writer-1');

    expect(mockedRename).toHaveBeenCalledWith({
      username: 'asil',
      repositoryName: 'demo',
      branchName: 'feature/login',
      newBranchName: 'feature/auth',
    });

    expect(response.body).toMatchObject({
      success: true,
      data: {
        branch: renamedBranch,
      },
    });
  });

  it('rejects invalid names', async () => {
    await request(app)
      .patch('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: '../main',
        newName: 'feature/auth',
      })
      .expect(400);

    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('rejects unexpected properties', async () => {
    await request(app)
      .patch('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/login',
        newName: 'feature/auth',
        force: true,
      })
      .expect(400);
  });

  it('denies users without WRITE access', async () => {
    mockedAuthorize.mockRejectedValue(
      new AppError('Access denied', 403, 'REPOSITORY_ACCESS_DENIED'),
    );

    await request(app)
      .patch('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/login',
        newName: 'feature/auth',
      })
      .expect(403);

    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('protects default branch', async () => {
    mockedRename.mockRejectedValue(
      new AppError('Default branch cannot be renamed', 409, 'GIT_DEFAULT_BRANCH_PROTECTED'),
    );

    const response = await request(app)
      .patch('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'main',
        newName: 'primary',
      })
      .expect(409);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'GIT_DEFAULT_BRANCH_PROTECTED',
      },
    });
  });

  it('returns branch conflict safely', async () => {
    mockedRename.mockRejectedValue(
      new AppError('Git branch rename conflict', 409, 'GIT_BRANCH_CONFLICT'),
    );

    const response = await request(app)
      .patch('/api/repositories/asil/demo/git/branches')
      .set('Authorization', 'Bearer test-token')
      .send({
        name: 'feature/login',
        newName: 'feature/auth',
      })
      .expect(409);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'GIT_BRANCH_CONFLICT',
      },
    });
  });
});
