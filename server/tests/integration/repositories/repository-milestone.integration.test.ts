import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';

import {
  createMilestone,
  listMilestones,
  getMilestone,
  updateMilestone,
  deleteMilestone,
} from '../../../src/services/milestones/milestone.service.js';

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

vi.mock('../../../src/services/milestones/milestone.service.js', () => ({
  createMilestone: vi.fn(),
  listMilestones: vi.fn(),
  getMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
}));

const mockedCreate = vi.mocked(createMilestone);
const mockedList = vi.mocked(listMilestones);
const mockedGet = vi.mocked(getMilestone);
const mockedUpdate = vi.mocked(updateMilestone);
const mockedDelete = vi.mocked(deleteMilestone);

const base = '/api/repositories/asil/demo/milestones';
const milestoneId = 'cl12345678901234567890123';
const dueDate = '2026-12-31T13:00:00.000Z';

const milestone = {
  id: milestoneId,
  repositoryId: 'repo-1',
  title: 'Version 1.0',
  description: 'First release',
  state: 'OPEN' as const,
  dueDate: new Date(dueDate),
  closedAt: null,
  createdAt: new Date('2026-10-08T10:00:00Z'),
  updatedAt: new Date('2026-10-08T10:00:00Z'),
};

describe('Repository milestone API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedCreate.mockResolvedValue(milestone);
    mockedList.mockResolvedValue({
      milestones: [
        {
          ...milestone,
          progress: {
            totalIssues: 0,
            closedIssues: 0,
            totalPullRequests: 0,
            completedPullRequests: 0,
            totalItems: 0,
            completedItems: 0,
            openItems: 0,
            percentage: 0,
          },
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
    mockedGet.mockResolvedValue({
      ...milestone,
      progress: {
        totalIssues: 0,
        closedIssues: 0,
        totalPullRequests: 0,
        completedPullRequests: 0,
        totalItems: 0,
        completedItems: 0,
        openItems: 0,
        percentage: 0,
      },
    });
    mockedUpdate.mockResolvedValue(milestone);
    mockedDelete.mockResolvedValue(undefined);
  });

  it('creates a milestone with a due date', async () => {
    const response = await request(app).post(base).send({
      title: 'Version 1.0',
      description: 'First release',
      dueDate,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.milestone.title).toBe('Version 1.0');

    expect(mockedCreate).toHaveBeenCalledWith('user-1', 'asil', 'demo', {
      title: 'Version 1.0',
      description: 'First release',
      dueDate: new Date(dueDate),
    });
  });

  it('rejects empty milestone titles', async () => {
    const response = await request(app).post(base).send({ title: '   ' });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects invalid due dates', async () => {
    const response = await request(app).post(base).send({
      title: 'Version 1.0',
      dueDate: 'tomorrow',
    });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects due dates without a timezone', async () => {
    const response = await request(app).post(base).send({
      title: 'Version 1.0',
      dueDate: '2026-12-31T13:00:00',
    });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects unknown creation fields', async () => {
    const response = await request(app).post(base).send({
      title: 'Version 1.0',
      unexpected: true,
    });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('does not allow setting state during creation', async () => {
    const response = await request(app).post(base).send({
      title: 'Version 1.0',
      state: 'CLOSED',
    });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('lists milestones with default pagination', async () => {
    const response = await request(app).get(base);

    expect(response.status).toBe(200);
    expect(response.body.data.milestones).toHaveLength(1);

    expect(mockedList).toHaveBeenCalledWith(
      'asil',
      'demo',
      {
        page: 1,
        limit: 20,
      },
      undefined,
    );
  });

  it('supports state filtering and custom pagination', async () => {
    const response = await request(app)
      .get(base)
      .query({
        state: 'CLOSED',
        page: '2',
        limit: '5',
      })
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);

    expect(mockedList).toHaveBeenCalledWith(
      'asil',
      'demo',
      {
        state: 'CLOSED',
        page: 2,
        limit: 5,
      },
      'user-1',
    );
  });

  it('rejects invalid pagination', async () => {
    const response = await request(app).get(base).query({ page: '0', limit: '101' });

    expect(response.status).toBe(400);
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('rejects invalid state filters', async () => {
    const response = await request(app).get(base).query({ state: 'MERGED' });

    expect(response.status).toBe(400);
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('gets a milestone by ID', async () => {
    const response = await request(app).get(`${base}/${milestoneId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.milestone.id).toBe(milestoneId);

    expect(mockedGet).toHaveBeenCalledWith('asil', 'demo', milestoneId, undefined);
  });

  it('rejects invalid milestone IDs', async () => {
    const response = await request(app).get(`${base}/invalid-id`);

    expect(response.status).toBe(400);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('closes a milestone through PATCH', async () => {
    const response = await request(app).patch(`${base}/${milestoneId}`).send({ state: 'CLOSED' });

    expect(response.status).toBe(200);

    expect(mockedUpdate).toHaveBeenCalledWith('user-1', 'asil', 'demo', milestoneId, {
      state: 'CLOSED',
    });
  });

  it('rejects empty milestone updates', async () => {
    const response = await request(app).patch(`${base}/${milestoneId}`).send({});

    expect(response.status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('rejects unknown update fields', async () => {
    const response = await request(app).patch(`${base}/${milestoneId}`).send({ unexpected: true });

    expect(response.status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('deletes a milestone', async () => {
    const response = await request(app).delete(`${base}/${milestoneId}`);

    expect(response.status).toBe(204);

    expect(mockedDelete).toHaveBeenCalledWith('user-1', 'asil', 'demo', milestoneId);
  });
});
