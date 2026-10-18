import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';

import {
  addIssueAssignee,
  listIssueAssignees,
  removeIssueAssignee,
} from '../../../src/services/issues/issue-assignee.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/auth.middleware.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId: string }).userId = 'owner-1';
    next();
  },
}));

vi.mock('../../../src/middleware/optional-auth.middleware.js', () => ({
  optionalAuthMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      (req as Request & { userId?: string }).userId = 'reader-1';
    }
    next();
  },
}));

vi.mock('../../../src/services/issues/issue-assignee.service.js', () => ({
  addIssueAssignee: vi.fn(),
  listIssueAssignees: vi.fn(),
  removeIssueAssignee: vi.fn(),
}));

const mockedAdd = vi.mocked(addIssueAssignee);
const mockedList = vi.mocked(listIssueAssignees);
const mockedRemove = vi.mocked(removeIssueAssignee);

const base = '/api/repositories/asil/demo/issues/1/assignees';

const assignee = {
  issueId: 'issue-1',
  userId: 'collab-1',
  assignedAt: new Date('2026-10-08T10:00:00Z'),
  user: {
    id: 'collab-1',
    username: 'alice',
    name: 'Alice',
    avatarUrl: null,
  },
};

describe('Repository issue assignees API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedAdd.mockResolvedValue(assignee);
    mockedList.mockResolvedValue([assignee]);
    mockedRemove.mockResolvedValue(undefined);
  });

  it('adds an issue assignee', async () => {
    const response = await request(app).post(base).send({ username: 'alice' });

    expect(response.status).toBe(201);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        assignee: {
          userId: 'collab-1',
          user: { username: 'alice' },
        },
      },
    });

    expect(mockedAdd).toHaveBeenCalledWith('owner-1', 'asil', 'demo', 1, 'alice');
  });

  it('rejects an empty assignee username', async () => {
    const response = await request(app).post(base).send({ username: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ISSUE_ASSIGNEE_DATA');
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('rejects unknown assignee creation fields', async () => {
    const response = await request(app).post(base).send({ username: 'alice', unexpected: true });

    expect(response.status).toBe(400);
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('lists issue assignees anonymously', async () => {
    const response = await request(app).get(base);

    expect(response.status).toBe(200);
    expect(response.body.data.assignees).toHaveLength(1);

    expect(mockedList).toHaveBeenCalledWith('asil', 'demo', 1, undefined);
  });

  it('passes optional authenticated user to list service', async () => {
    const response = await request(app).get(base).set('Authorization', 'Bearer test');

    expect(response.status).toBe(200);

    expect(mockedList).toHaveBeenCalledWith('asil', 'demo', 1, 'reader-1');
  });

  it('removes an issue assignee', async () => {
    const response = await request(app).delete(`${base}/alice`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { deleted: true },
    });

    expect(mockedRemove).toHaveBeenCalledWith('owner-1', 'asil', 'demo', 1, 'alice');
  });

  it('rejects invalid issue number', async () => {
    const response = await request(app).get('/api/repositories/asil/demo/issues/invalid/assignees');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ISSUE_NUMBER');
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('rejects missing assignee username in POST body', async () => {
    const response = await request(app).post(base).send({});

    expect(response.status).toBe(400);
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('maps duplicate assignment to HTTP 409', async () => {
    mockedAdd.mockRejectedValue(
      new AppError('User is already assigned to this issue', 409, 'ISSUE_ASSIGNEE_ALREADY_EXISTS'),
    );

    const response = await request(app).post(base).send({ username: 'alice' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ISSUE_ASSIGNEE_ALREADY_EXISTS');
  });

  it('maps ineligible assignee to HTTP 403', async () => {
    mockedAdd.mockRejectedValue(
      new AppError(
        'Assignee must be a repository owner or collaborator',
        403,
        'ISSUE_ASSIGNEE_NOT_ELIGIBLE',
      ),
    );

    const response = await request(app).post(base).send({ username: 'outsider' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ISSUE_ASSIGNEE_NOT_ELIGIBLE');
  });
});
