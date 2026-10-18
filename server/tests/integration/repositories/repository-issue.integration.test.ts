import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';

import {
  createIssue,
  listIssues,
  getIssue,
  updateIssue,
} from '../../../src/services/issues/issue.service.js';

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

vi.mock('../../../src/services/issues/issue.service.js', () => ({
  createIssue: vi.fn(),
  listIssues: vi.fn(),
  getIssue: vi.fn(),
  updateIssue: vi.fn(),
}));

const mockedCreate = vi.mocked(createIssue);
const mockedList = vi.mocked(listIssues);
const mockedGet = vi.mocked(getIssue);
const mockedUpdate = vi.mocked(updateIssue);

const base = '/api/repositories/asil/demo/issues';

const issue = {
  id: 'issue-1',
  repositoryId: 'repo-1',
  milestoneId: null,
  milestone: null,
  labels: [],
  number: 1,
  creatorId: 'user-1',
  title: 'Example bug',
  body: 'Bug description',
  state: 'OPEN' as const,
  closedAt: null,
  createdAt: new Date('2026-10-08T10:00:00Z'),
  updatedAt: new Date('2026-10-08T10:00:00Z'),
  creator: {
    id: 'user-1',
    username: 'asil',
    name: 'Asil',
    avatarUrl: null,
  },
};

describe('Repository issue API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedCreate.mockResolvedValue(issue);
    mockedGet.mockResolvedValue(issue);
    mockedUpdate.mockResolvedValue(issue);
    mockedList.mockResolvedValue({
      issues: [issue],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('creates an issue', async () => {
    const response = await request(app).post(base).send({
      title: 'Example bug',
      body: 'Bug description',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        issue: {
          number: 1,
          title: 'Example bug',
        },
      },
    });

    expect(mockedCreate).toHaveBeenCalledWith('user-1', 'asil', 'demo', {
      title: 'Example bug',
      body: 'Bug description',
    });
  });

  it('rejects empty issue title', async () => {
    const response = await request(app).post(base).send({ title: '   ' });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects unknown issue creation fields', async () => {
    const response = await request(app).post(base).send({
      title: 'Bug',
      unexpected: true,
    });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('lists issues with default pagination', async () => {
    const response = await request(app).get(base);

    expect(response.status).toBe(200);
    expect(response.body.data.issues).toHaveLength(1);

    expect(mockedList).toHaveBeenCalledWith('asil', 'demo', undefined, {
      page: 1,
      limit: 20,
    });
  });

  it('lists closed issues with pagination', async () => {
    const response = await request(app).get(base).query({
      state: 'CLOSED',
      page: '2',
      limit: '5',
    });

    expect(response.status).toBe(200);

    expect(mockedList).toHaveBeenCalledWith('asil', 'demo', undefined, {
      state: 'CLOSED',
      page: 2,
      limit: 5,
    });
  });

  it('rejects invalid issue list query', async () => {
    const response = await request(app).get(base).query({ state: 'INVALID' });

    expect(response.status).toBe(400);
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('gets a single issue', async () => {
    const response = await request(app).get(`${base}/1`);

    expect(response.status).toBe(200);
    expect(response.body.data.issue.number).toBe(1);

    expect(mockedGet).toHaveBeenCalledWith('asil', 'demo', 1, undefined);
  });

  it('returns the assigned issue milestone', async () => {
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
      ...issue,
      milestoneId: assignedMilestone.id,
      milestone: assignedMilestone,
    });

    const response = await request(app).get(`${base}/1`).expect(200);

    expect(response.body.data.issue).toMatchObject({
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

    expect(response.body.data.issue.milestoneId).toBe(response.body.data.issue.milestone.id);
  });
  it('returns assigned issue labels', async () => {
    const assignedLabel = {
      id: 'cl12345678901234567890123',
      repositoryId: 'repo-1',
      name: 'bug',
      color: '#FF5733',
      description: null,
      createdAt: new Date('2026-10-08T10:00:00Z'),
      updatedAt: new Date('2026-10-08T10:00:00Z'),
    };

    mockedGet.mockResolvedValue({
      ...issue,
      labels: [
        {
          issueId: issue.id,
          labelId: assignedLabel.id,
          createdAt: new Date('2026-10-08T10:00:00Z'),
          label: assignedLabel,
        },
      ],
    });

    const response = await request(app).get(`${base}/1`);

    expect(response.status).toBe(200);
    expect(response.body.data.issue.labels).toHaveLength(1);
    expect(response.body.data.issue.labels[0].label).toMatchObject({
      id: assignedLabel.id,
      name: 'bug',
      color: '#FF5733',
    });
  });
  it('rejects invalid issue number', async () => {
    const response = await request(app).get(`${base}/invalid`);

    expect(response.status).toBe(400);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('updates an issue', async () => {
    const response = await request(app).patch(`${base}/1`).send({
      title: 'Updated bug',
      state: 'CLOSED',
    });

    expect(response.status).toBe(200);

    expect(mockedUpdate).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, {
      title: 'Updated bug',
      state: 'CLOSED',
    });
  });

  it('rejects empty issue update', async () => {
    const response = await request(app).patch(`${base}/1`).send({});

    expect(response.status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
