import type { NextFunction, Request, Response } from 'express';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';

import {
  createPullRequest,
  getPullRequest,
  getPullRequestCommits,
  getPullRequestDiff,
  getPullRequestMergeability,
  listPullRequests,
  mergePullRequest,
  updatePullRequest,
} from '../../../src/services/pull-requests/pull-request.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/auth.middleware.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId: string }).userId = 'user-1';

    next();
  },
}));

vi.mock('../../../src/middleware/optional-auth.middleware.js', () => ({
  optionalAuthMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      (req as Request & { userId?: string }).userId = 'user-1';
    }

    next();
  },
}));

vi.mock('../../../src/services/pull-requests/pull-request.service.js', () => ({
  createPullRequest: vi.fn(),
  getPullRequest: vi.fn(),
  getPullRequestCommits: vi.fn(),
  getPullRequestDiff: vi.fn(),
  getPullRequestMergeability: vi.fn(),
  listPullRequests: vi.fn(),
  mergePullRequest: vi.fn(),
  updatePullRequest: vi.fn(),
}));

const mockedCreate = vi.mocked(createPullRequest);
const mockedGet = vi.mocked(getPullRequest);
const mockedCommits = vi.mocked(getPullRequestCommits);
const mockedDiff = vi.mocked(getPullRequestDiff);
const mockedMergeability = vi.mocked(getPullRequestMergeability);
const mockedList = vi.mocked(listPullRequests);
const mockedMerge = vi.mocked(mergePullRequest);
const mockedUpdate = vi.mocked(updatePullRequest);

const pullRequest = {
  id: 'pr-1',
  repositoryId: 'repo-1',
  milestoneId: null,
  milestone: null,
  labels: [],
  number: 1,
  authorId: 'user-1',
  title: 'Feature PR',
  description: 'Phase 7 test',
  sourceBranch: 'feature',
  targetBranch: 'main',
  state: 'OPEN' as const,
  mergedAt: null,
  mergedById: null,
  mergeSha: null,
  createdAt: new Date('2026-10-07T10:00:00Z'),
  updatedAt: new Date('2026-10-07T10:00:00Z'),
  author: {
    id: 'user-1',
    username: 'asil',
    name: 'Asil',
    avatarUrl: null,
  },
  mergedBy: null,
};

const commit = {
  sha: '3333333333333333333333333333333333333333',
  parents: ['1111111111111111111111111111111111111111'],
  author: {
    name: 'Author',
    email: 'author@gitzone.local',
    date: '2026-10-07T10:00:00+05:00',
  },
  committer: {
    name: 'Committer',
    email: 'committer@gitzone.local',
    date: '2026-10-07T10:01:00+05:00',
  },
  message: 'feat: PR commit',
};

const comparison = {
  base: '1111111111111111111111111111111111111111',
  head: '2222222222222222222222222222222222222222',
  mergeBase: '1111111111111111111111111111111111111111',
  aheadBy: 1,
  behindBy: 0,
  diff: {
    diff: 'diff --git a/file.ts b/file.ts',
    size: 64,
    truncated: false,
    binary: false,
  },
};

const mergeability = {
  mergeable: true,
  reason: null,
  sourceSha: '2222222222222222222222222222222222222222',
  targetSha: '1111111111111111111111111111111111111111',
  mergeBase: '1111111111111111111111111111111111111111',
  aheadBy: 1,
  behindBy: 0,
};

describe('repository pull request API', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedCreate.mockResolvedValue(pullRequest);
    mockedGet.mockResolvedValue(pullRequest);
    mockedList.mockResolvedValue([pullRequest]);
    mockedUpdate.mockResolvedValue(pullRequest);
    mockedCommits.mockResolvedValue([commit]);
    mockedDiff.mockResolvedValue(comparison);
    mockedMergeability.mockResolvedValue(mergeability);
    mockedMerge.mockResolvedValue({
      ...pullRequest,
      state: 'MERGED',
      mergedAt: new Date('2026-10-07T11:00:00Z'),
      mergedById: 'user-1',
      mergeSha: '5555555555555555555555555555555555555555',
      mergedBy: {
        id: 'user-1',
        username: 'asil',
        name: 'Asil',
        avatarUrl: null,
      },
    });
  });

  it('creates a pull request', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/pulls')
      .set('Authorization', 'Bearer test')
      .send({
        title: 'Feature PR',
        description: 'Phase 7 test',
        sourceBranch: 'feature',
        targetBranch: 'main',
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.pullRequest.number).toBe(1);

    expect(mockedCreate).toHaveBeenCalledWith('user-1', 'asil', 'demo', {
      title: 'Feature PR',
      description: 'Phase 7 test',
      sourceBranch: 'feature',
      targetBranch: 'main',
    });
  });

  it('lists pull requests', async () => {
    const response = await request(app)
      .get('/api/repositories/asil/demo/pulls')
      .query({ state: 'OPEN' })
      .expect(200);

    expect(response.body.data.pullRequests).toHaveLength(1);

    expect(mockedList).toHaveBeenCalledWith('asil', 'demo', undefined, 'OPEN');
  });

  it('gets one pull request', async () => {
    const response = await request(app).get('/api/repositories/asil/demo/pulls/1').expect(200);

    expect(response.body.data.pullRequest.number).toBe(1);

    expect(mockedGet).toHaveBeenCalledWith('asil', 'demo', 1, undefined);
  });

  it('returns the assigned pull request milestone', async () => {
    const assignedMilestone = {
      id: 'milestone-1',
      repositoryId: 'repo-1',
      title: 'Version 1.0',
      description: 'First release',
      state: 'OPEN' as const,
      dueDate: new Date('2026-12-31T13:00:00Z'),
      closedAt: null,
    };

    mockedGet.mockResolvedValue({
      ...pullRequest,
      milestoneId: assignedMilestone.id,
      milestone: assignedMilestone,
    });

    const response = await request(app).get('/api/repositories/asil/demo/pulls/1').expect(200);

    expect(response.body.data.pullRequest).toMatchObject({
      milestoneId: assignedMilestone.id,
      milestone: {
        id: assignedMilestone.id,
        repositoryId: 'repo-1',
        title: 'Version 1.0',
        description: 'First release',
        state: 'OPEN',
        dueDate: '2026-12-31T13:00:00.000Z',
        closedAt: null,
      },
    });

    expect(response.body.data.pullRequest.milestoneId).toBe(
      response.body.data.pullRequest.milestone.id,
    );
  });
  it('returns assigned pull request labels', async () => {
    const assignedLabel = {
      id: 'cl12345678901234567890123',
      repositoryId: 'repo-1',
      name: 'enhancement',
      color: '#22C55E',
      description: null,
      createdAt: new Date('2026-10-08T10:00:00Z'),
      updatedAt: new Date('2026-10-08T10:00:00Z'),
    };

    mockedGet.mockResolvedValue({
      ...pullRequest,
      labels: [
        {
          pullRequestId: pullRequest.id,
          labelId: assignedLabel.id,
          createdAt: new Date('2026-10-08T10:00:00Z'),
          label: assignedLabel,
        },
      ],
    });

    const response = await request(app).get('/api/repositories/asil/demo/pulls/1');

    expect(response.status).toBe(200);
    expect(response.body.data.pullRequest.labels).toHaveLength(1);
    expect(response.body.data.pullRequest.labels[0].label).toMatchObject({
      id: assignedLabel.id,
      name: 'enhancement',
      color: '#22C55E',
    });
  });
  it('updates a pull request', async () => {
    await request(app)
      .patch('/api/repositories/asil/demo/pulls/1')
      .set('Authorization', 'Bearer test')
      .send({
        title: 'Updated PR',
      })
      .expect(200);

    expect(mockedUpdate).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, {
      title: 'Updated PR',
    });
  });

  it('returns pull request commits', async () => {
    const response = await request(app)
      .get('/api/repositories/asil/demo/pulls/1/commits')
      .expect(200);

    expect(response.body.data.commits).toHaveLength(1);

    expect(mockedCommits).toHaveBeenCalledWith('asil', 'demo', 1, undefined);
  });

  it('returns pull request diff', async () => {
    const response = await request(app).get('/api/repositories/asil/demo/pulls/1/diff').expect(200);

    expect(response.body.data.comparison.aheadBy).toBe(1);

    expect(mockedDiff).toHaveBeenCalledWith('asil', 'demo', 1, undefined);
  });

  it('returns mergeability', async () => {
    const response = await request(app)
      .get('/api/repositories/asil/demo/pulls/1/mergeability')
      .expect(200);

    expect(response.body.data.mergeability.mergeable).toBe(true);

    expect(mockedMergeability).toHaveBeenCalledWith('asil', 'demo', 1, undefined);
  });

  it('merges a pull request', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/pulls/1/merge')
      .set('Authorization', 'Bearer test')
      .expect(200);

    expect(response.body.data.pullRequest.state).toBe('MERGED');

    expect(mockedMerge).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1);
  });

  it('rejects invalid pull request number', async () => {
    const response = await request(app).get('/api/repositories/asil/demo/pulls/nope').expect(400);

    expect(response.body.success).toBe(false);
  });

  it('rejects identical source and target branches', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/pulls')
      .set('Authorization', 'Bearer test')
      .send({
        title: 'Invalid PR',
        sourceBranch: 'main',
        targetBranch: 'main',
      })
      .expect(400);

    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
