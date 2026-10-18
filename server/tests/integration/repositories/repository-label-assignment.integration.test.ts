import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';

import {
  addIssueLabel,
  removeIssueLabel,
  addPullRequestLabel,
  removePullRequestLabel,
} from '../../../src/services/labels/label-assignment.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/auth.middleware.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId: string }).userId = 'user-1';
    next();
  },
}));

vi.mock('../../../src/services/labels/label-assignment.service.js', () => ({
  addIssueLabel: vi.fn(),
  removeIssueLabel: vi.fn(),
  addPullRequestLabel: vi.fn(),
  removePullRequestLabel: vi.fn(),
}));

const mockedAddIssue = vi.mocked(addIssueLabel);
const mockedRemoveIssue = vi.mocked(removeIssueLabel);
const mockedAddPull = vi.mocked(addPullRequestLabel);
const mockedRemovePull = vi.mocked(removePullRequestLabel);

const issueBase = '/api/repositories/asil/demo/issues/1/labels';
const pullBase = '/api/repositories/asil/demo/pulls/2/labels';

const labelId = 'cl12345678901234567890123';

const label = {
  id: labelId,
  repositoryId: 'repo-1',
  name: 'bug',
  color: '#FF5733',
  description: null,
  createdAt: new Date('2026-10-08T10:00:00Z'),
  updatedAt: new Date('2026-10-08T10:00:00Z'),
};

describe('Repository label assignment API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedAddIssue.mockResolvedValue(label);
    mockedRemoveIssue.mockResolvedValue(undefined);
    mockedAddPull.mockResolvedValue(label);
    mockedRemovePull.mockResolvedValue(undefined);
  });

  it('adds a label to an issue', async () => {
    const response = await request(app).post(issueBase).send({ labelId });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        label: {
          id: labelId,
          name: 'bug',
        },
      },
    });

    expect(mockedAddIssue).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, labelId);
  });

  it('rejects missing issue label ID', async () => {
    const response = await request(app).post(issueBase).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_LABEL_ASSIGNMENT_DATA');
    expect(mockedAddIssue).not.toHaveBeenCalled();
  });

  it('rejects malformed issue label ID', async () => {
    const response = await request(app).post(issueBase).send({ labelId: 'invalid-id' });

    expect(response.status).toBe(400);
    expect(mockedAddIssue).not.toHaveBeenCalled();
  });

  it('rejects unknown issue assignment fields', async () => {
    const response = await request(app).post(issueBase).send({ labelId, unexpected: true });

    expect(response.status).toBe(400);
    expect(mockedAddIssue).not.toHaveBeenCalled();
  });

  it('rejects invalid issue number', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/issues/invalid/labels')
      .send({ labelId });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_LABEL_ASSIGNMENT_NUMBER');
    expect(mockedAddIssue).not.toHaveBeenCalled();
  });

  it('removes a label from an issue', async () => {
    const response = await request(app).delete(`${issueBase}/${labelId}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');

    expect(mockedRemoveIssue).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, labelId);
  });

  it('rejects invalid issue label ID on removal', async () => {
    const response = await request(app).delete(`${issueBase}/invalid-id`);

    expect(response.status).toBe(400);
    expect(mockedRemoveIssue).not.toHaveBeenCalled();
  });

  it('maps duplicate issue assignment to HTTP 409', async () => {
    mockedAddIssue.mockRejectedValue(
      new AppError('Label is already assigned', 409, 'LABEL_ALREADY_ASSIGNED'),
    );

    const response = await request(app).post(issueBase).send({ labelId });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LABEL_ALREADY_ASSIGNED');
  });

  it('maps unauthorized issue assignment to HTTP 403', async () => {
    mockedAddIssue.mockRejectedValue(new AppError('Forbidden', 403, 'FORBIDDEN'));

    const response = await request(app).post(issueBase).send({ labelId });

    expect(response.status).toBe(403);
  });

  it('maps missing issue to HTTP 404', async () => {
    mockedAddIssue.mockRejectedValue(new AppError('Issue not found', 404, 'ISSUE_NOT_FOUND'));

    const response = await request(app).post(issueBase).send({ labelId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ISSUE_NOT_FOUND');
  });

  it('adds a label to a pull request', async () => {
    const response = await request(app).post(pullBase).send({ labelId });

    expect(response.status).toBe(201);
    expect(response.body.data.label.id).toBe(labelId);

    expect(mockedAddPull).toHaveBeenCalledWith('user-1', 'asil', 'demo', 2, labelId);
  });

  it('rejects invalid pull request number', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/pulls/invalid/labels')
      .send({ labelId });

    expect(response.status).toBe(400);
    expect(mockedAddPull).not.toHaveBeenCalled();
  });

  it('rejects unknown pull request assignment fields', async () => {
    const response = await request(app).post(pullBase).send({ labelId, unexpected: true });

    expect(response.status).toBe(400);
    expect(mockedAddPull).not.toHaveBeenCalled();
  });

  it('removes a label from a pull request', async () => {
    const response = await request(app).delete(`${pullBase}/${labelId}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');

    expect(mockedRemovePull).toHaveBeenCalledWith('user-1', 'asil', 'demo', 2, labelId);
  });

  it('rejects invalid pull request label ID on removal', async () => {
    const response = await request(app).delete(`${pullBase}/invalid-id`);

    expect(response.status).toBe(400);
    expect(mockedRemovePull).not.toHaveBeenCalled();
  });

  it('maps duplicate pull request assignment to HTTP 409', async () => {
    mockedAddPull.mockRejectedValue(
      new AppError('Label is already assigned', 409, 'LABEL_ALREADY_ASSIGNED'),
    );

    const response = await request(app).post(pullBase).send({ labelId });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LABEL_ALREADY_ASSIGNED');
  });

  it('maps missing pull request to HTTP 404', async () => {
    mockedAddPull.mockRejectedValue(
      new AppError('Pull request not found', 404, 'PULL_REQUEST_NOT_FOUND'),
    );

    const response = await request(app).post(pullBase).send({ labelId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PULL_REQUEST_NOT_FOUND');
  });

  it('maps unassigned issue label removal to HTTP 404', async () => {
    mockedRemoveIssue.mockRejectedValue(
      new AppError('Label is not assigned', 404, 'ISSUE_LABEL_NOT_FOUND'),
    );

    const response = await request(app).delete(`${issueBase}/${labelId}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ISSUE_LABEL_NOT_FOUND');
  });

  it('maps unassigned pull request label removal to HTTP 404', async () => {
    mockedRemovePull.mockRejectedValue(
      new AppError('Label is not assigned', 404, 'PULL_REQUEST_LABEL_NOT_FOUND'),
    );

    const response = await request(app).delete(`${pullBase}/${labelId}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PULL_REQUEST_LABEL_NOT_FOUND');
  });
});
