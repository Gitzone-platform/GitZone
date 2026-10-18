import type { NextFunction, Request, Response } from 'express';

import request from 'supertest';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { getGitBranch } from '../../../src/services/git/git-branch.service.js';
import { authorizeRepositoryContentRead } from '../../../src/services/repositories/repository-content-access.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/optional-auth.middleware.js', () => ({
  optionalAuthMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      (
        req as Request & {
          userId?: string;
        }
      ).userId = 'viewer-1';
    }

    next();
  },
}));

vi.mock('../../../src/services/repositories/repository-content-access.service.js', () => ({
  authorizeRepositoryContentRead: vi.fn(),
}));

vi.mock('../../../src/services/git/git-branch.service.js', () => ({
  getGitBranch: vi.fn(),
}));

const mockedAuthorize = vi.mocked(authorizeRepositoryContentRead);

const mockedGetGitBranch = vi.mocked(getGitBranch);

const accessResult = {
  repositoryId: 'repo-1',
  repositoryName: 'demo',
  repositoryOwnerId: 'owner-1',
  repositoryOwnerUsername: 'asil',
  isPrivate: false,
  permission: 'PUBLIC',
} as const;

const branchResult = {
  name: 'develop',
  fullName: 'refs/heads/develop',
  oid: '2222222222222222222222222222222222222222',
  objectType: 'commit' as const,
  isDefault: false,
};

describe('repository branch API', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedAuthorize.mockResolvedValue(accessResult);

    mockedGetGitBranch.mockResolvedValue(branchResult);
  });

  it('returns branch details', async () => {
    const response = await request(app)
      .get('/api/repositories/asil/demo/git/branches/details?name=develop')
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        branch: branchResult,
      },
    });

    expect(mockedAuthorize).toHaveBeenCalledWith('asil', 'demo', undefined);

    expect(mockedGetGitBranch).toHaveBeenCalledWith('asil', 'demo', 'develop');
  });

  it('passes authenticated user to authorization', async () => {
    await request(app)
      .get('/api/repositories/asil/demo/git/branches/details?name=develop')
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    expect(mockedAuthorize).toHaveBeenCalledWith('asil', 'demo', 'viewer-1');
  });

  it('supports branch names containing slashes', async () => {
    mockedGetGitBranch.mockResolvedValue({
      name: 'feature/login',
      fullName: 'refs/heads/feature/login',
      oid: '3333333333333333333333333333333333333333',
      objectType: 'commit',
      isDefault: false,
    });

    await request(app)
      .get('/api/repositories/asil/demo/git/branches/details?name=feature%2Flogin')
      .expect(200);

    expect(mockedGetGitBranch).toHaveBeenCalledWith('asil', 'demo', 'feature/login');
  });
  it('returns default branch details', async () => {
    mockedGetGitBranch.mockResolvedValue({
      name: 'main',
      fullName: 'refs/heads/main',
      oid: '1111111111111111111111111111111111111111',
      objectType: 'commit',
      isDefault: true,
    });

    const response = await request(app)
      .get('/api/repositories/asil/demo/git/branches/details?name=main')
      .expect(200);

    expect(response.body.data.branch.isDefault).toBe(true);
  });

  it('returns 404 for a missing branch', async () => {
    mockedGetGitBranch.mockRejectedValue(
      new AppError('Git branch not found', 404, 'GIT_BRANCH_NOT_FOUND'),
    );

    const response = await request(app)
      .get('/api/repositories/asil/demo/git/branches/details?name=missing')
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'GIT_BRANCH_NOT_FOUND',
      },
    });
  });

  it('does not read branch when repository authorization fails', async () => {
    mockedAuthorize.mockRejectedValue(
      new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND'),
    );

    const response = await request(app)
      .get('/api/repositories/asil/private-repo/git/branches/details?name=main')
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_NOT_FOUND',
      },
    });

    expect(mockedGetGitBranch).not.toHaveBeenCalled();
  });
});
