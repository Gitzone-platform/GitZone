import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';

import {
  createIssueComment,
  listIssueComments,
  updateIssueComment,
  deleteIssueComment,
} from '../../../src/services/issues/issue-comment.service.js';

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

vi.mock('../../../src/services/issues/issue-comment.service.js', () => ({
  createIssueComment: vi.fn(),
  listIssueComments: vi.fn(),
  updateIssueComment: vi.fn(),
  deleteIssueComment: vi.fn(),
}));

const mockedCreate = vi.mocked(createIssueComment);
const mockedList = vi.mocked(listIssueComments);
const mockedUpdate = vi.mocked(updateIssueComment);
const mockedDelete = vi.mocked(deleteIssueComment);

const base = '/api/repositories/asil/demo/issues/1/comments';

const comment = {
  id: 'comment-1',
  issueId: 'issue-1',
  authorId: 'user-1',
  body: 'First comment',
  createdAt: new Date('2026-10-08T10:00:00Z'),
  updatedAt: new Date('2026-10-08T10:00:00Z'),
  author: {
    id: 'user-1',
    username: 'asil',
    name: 'Asil',
    avatarUrl: null,
  },
};

describe('Repository issue comments API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedCreate.mockResolvedValue(comment);
    mockedUpdate.mockResolvedValue(comment);
    mockedDelete.mockResolvedValue(undefined);

    mockedList.mockResolvedValue({
      comments: [comment],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('creates a comment', async () => {
    const response = await request(app).post(base).send({ body: 'First comment' });

    expect(response.status).toBe(201);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        comment: {
          id: 'comment-1',
          body: 'First comment',
        },
      },
    });

    expect(mockedCreate).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, {
      body: 'First comment',
    });
  });

  it('rejects empty comment body', async () => {
    const response = await request(app).post(base).send({ body: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ISSUE_COMMENT_DATA');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects unknown comment creation fields', async () => {
    const response = await request(app).post(base).send({
      body: 'Hello',
      unexpected: true,
    });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('lists comments with default pagination', async () => {
    const response = await request(app).get(base);

    expect(response.status).toBe(200);
    expect(response.body.data.comments).toHaveLength(1);

    expect(mockedList).toHaveBeenCalledWith('asil', 'demo', 1, undefined, {
      page: 1,
      limit: 20,
    });
  });

  it('lists comments with custom pagination', async () => {
    const response = await request(app).get(base).query({ page: '2', limit: '5' });

    expect(response.status).toBe(200);

    expect(mockedList).toHaveBeenCalledWith('asil', 'demo', 1, undefined, {
      page: 2,
      limit: 5,
    });
  });

  it('rejects invalid comments pagination', async () => {
    const response = await request(app).get(base).query({ limit: '101' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ISSUE_COMMENTS_QUERY');
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('updates a comment', async () => {
    const response = await request(app)
      .patch(`${base}/comment-1`)
      .send({ body: 'Updated comment' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(mockedUpdate).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, 'comment-1', {
      body: 'Updated comment',
    });
  });

  it('rejects invalid comment update', async () => {
    const response = await request(app).patch(`${base}/comment-1`).send({ body: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ISSUE_COMMENT_UPDATE');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('deletes a comment', async () => {
    const response = await request(app).delete(`${base}/comment-1`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { deleted: true },
    });

    expect(mockedDelete).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, 'comment-1');
  });

  it('rejects invalid issue number', async () => {
    const response = await request(app).get('/api/repositories/asil/demo/issues/invalid/comments');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ISSUE_NUMBER');
    expect(mockedList).not.toHaveBeenCalled();
  });
});
