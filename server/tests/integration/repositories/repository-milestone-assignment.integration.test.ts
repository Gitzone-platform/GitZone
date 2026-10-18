import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';

import {
  assignIssueMilestone,
  assignPullRequestMilestone,
} from '../../../src/services/milestones/milestone-assignment.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/auth.middleware.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId: string }).userId = 'user-1';
    next();
  },
}));

vi.mock('../../../src/services/milestones/milestone-assignment.service.js', () => ({
  assignIssueMilestone: vi.fn(),
  assignPullRequestMilestone: vi.fn(),
}));

const mockedIssue = vi.mocked(assignIssueMilestone);
const mockedPull = vi.mocked(assignPullRequestMilestone);

const milestoneId = 'cl12345678901234567890123';

const issueUrl = '/api/repositories/asil/demo/issues/1/milestone';

const pullUrl = '/api/repositories/asil/demo/pulls/2/milestone';

const issue = {
  id: 'issue-1',
  repositoryId: 'repo-1',
  number: 1,
  milestoneId,
  milestone: { id: milestoneId, title: 'Version 1.0' },
};

const pullRequest = {
  id: 'pr-1',
  repositoryId: 'repo-1',
  number: 2,
  milestoneId,
  milestone: { id: milestoneId, title: 'Version 1.0' },
};

describe('Repository milestone assignment API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedIssue.mockResolvedValue(issue as never);
    mockedPull.mockResolvedValue(pullRequest as never);
  });

  it('assigns a milestone to an issue', async () => {
    const response = await request(app).patch(issueUrl).send({ milestoneId });

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        issue: {
          id: 'issue-1',
          milestoneId,
        },
      },
    });

    expect(mockedIssue).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, milestoneId);
  });

  it('removes a milestone from an issue using null', async () => {
    mockedIssue.mockResolvedValue({
      ...issue,
      milestoneId: null,
      milestone: null,
    } as never);

    const response = await request(app).patch(issueUrl).send({ milestoneId: null });

    expect(response.status).toBe(200);
    expect(response.body.data.issue.milestoneId).toBeNull();

    expect(mockedIssue).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, null);
  });

  it('rejects missing milestoneId for issue', async () => {
    const response = await request(app).patch(issueUrl).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_MILESTONE_ASSIGNMENT');
    expect(mockedIssue).not.toHaveBeenCalled();
  });

  it('rejects malformed milestoneId for issue', async () => {
    const response = await request(app).patch(issueUrl).send({ milestoneId: 'invalid-id' });

    expect(response.status).toBe(400);
    expect(mockedIssue).not.toHaveBeenCalled();
  });

  it('rejects numeric milestoneId for issue', async () => {
    const response = await request(app).patch(issueUrl).send({ milestoneId: 123 });

    expect(response.status).toBe(400);
    expect(mockedIssue).not.toHaveBeenCalled();
  });

  it('rejects unknown fields for issue assignment', async () => {
    const response = await request(app).patch(issueUrl).send({ milestoneId, unexpected: true });

    expect(response.status).toBe(400);
    expect(mockedIssue).not.toHaveBeenCalled();
  });

  it('rejects invalid issue number', async () => {
    const response = await request(app)
      .patch('/api/repositories/asil/demo/issues/invalid/milestone')
      .send({ milestoneId });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_NUMBER');
    expect(mockedIssue).not.toHaveBeenCalled();
  });

  it('rejects zero issue number', async () => {
    const response = await request(app)
      .patch('/api/repositories/asil/demo/issues/0/milestone')
      .send({ milestoneId });

    expect(response.status).toBe(400);
    expect(mockedIssue).not.toHaveBeenCalled();
  });

  it('maps unauthorized issue assignment to 403', async () => {
    mockedIssue.mockRejectedValue(new AppError('Forbidden', 403, 'FORBIDDEN'));

    const response = await request(app).patch(issueUrl).send({ milestoneId });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('maps foreign milestone to 404 for issue', async () => {
    mockedIssue.mockRejectedValue(new AppError('Milestone not found', 404, 'MILESTONE_NOT_FOUND'));

    const response = await request(app).patch(issueUrl).send({ milestoneId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('MILESTONE_NOT_FOUND');
  });

  it('maps missing issue to 404', async () => {
    mockedIssue.mockRejectedValue(new AppError('Issue not found', 404, 'ISSUE_NOT_FOUND'));

    const response = await request(app).patch(issueUrl).send({ milestoneId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ISSUE_NOT_FOUND');
  });

  it('assigns a milestone to a pull request', async () => {
    const response = await request(app).patch(pullUrl).send({ milestoneId });

    expect(response.status).toBe(200);

    expect(response.body.data.pullRequest).toMatchObject({
      id: 'pr-1',
      milestoneId,
    });

    expect(mockedPull).toHaveBeenCalledWith('user-1', 'asil', 'demo', 2, milestoneId);
  });

  it('removes a milestone from a pull request using null', async () => {
    mockedPull.mockResolvedValue({
      ...pullRequest,
      milestoneId: null,
      milestone: null,
    } as never);

    const response = await request(app).patch(pullUrl).send({ milestoneId: null });

    expect(response.status).toBe(200);
    expect(response.body.data.pullRequest.milestoneId).toBeNull();

    expect(mockedPull).toHaveBeenCalledWith('user-1', 'asil', 'demo', 2, null);
  });

  it('rejects missing milestoneId for pull request', async () => {
    const response = await request(app).patch(pullUrl).send({});

    expect(response.status).toBe(400);
    expect(mockedPull).not.toHaveBeenCalled();
  });

  it('rejects malformed milestoneId for pull request', async () => {
    const response = await request(app).patch(pullUrl).send({ milestoneId: 'invalid-id' });

    expect(response.status).toBe(400);
    expect(mockedPull).not.toHaveBeenCalled();
  });

  it('rejects unknown fields for pull request assignment', async () => {
    const response = await request(app).patch(pullUrl).send({ milestoneId, unexpected: true });

    expect(response.status).toBe(400);
    expect(mockedPull).not.toHaveBeenCalled();
  });

  it('rejects invalid pull request number', async () => {
    const response = await request(app)
      .patch('/api/repositories/asil/demo/pulls/invalid/milestone')
      .send({ milestoneId });

    expect(response.status).toBe(400);
    expect(mockedPull).not.toHaveBeenCalled();
  });

  it('maps unauthorized pull request assignment to 403', async () => {
    mockedPull.mockRejectedValue(new AppError('Forbidden', 403, 'FORBIDDEN'));

    const response = await request(app).patch(pullUrl).send({ milestoneId });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('maps foreign milestone to 404 for pull request', async () => {
    mockedPull.mockRejectedValue(new AppError('Milestone not found', 404, 'MILESTONE_NOT_FOUND'));

    const response = await request(app).patch(pullUrl).send({ milestoneId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('MILESTONE_NOT_FOUND');
  });

  it('maps missing pull request to 404', async () => {
    mockedPull.mockRejectedValue(
      new AppError('Pull request not found', 404, 'PULL_REQUEST_NOT_FOUND'),
    );

    const response = await request(app).patch(pullUrl).send({ milestoneId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PULL_REQUEST_NOT_FOUND');
  });
});
