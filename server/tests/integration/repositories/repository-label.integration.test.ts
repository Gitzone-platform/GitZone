import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';

import {
  createLabel,
  listLabels,
  getLabel,
  updateLabel,
  deleteLabel,
} from '../../../src/services/labels/label.service.js';

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

vi.mock('../../../src/services/labels/label.service.js', () => ({
  createLabel: vi.fn(),
  listLabels: vi.fn(),
  getLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
}));

const mockedCreate = vi.mocked(createLabel);
const mockedList = vi.mocked(listLabels);
const mockedGet = vi.mocked(getLabel);
const mockedUpdate = vi.mocked(updateLabel);
const mockedDelete = vi.mocked(deleteLabel);

const base = '/api/repositories/asil/demo/labels';
const labelId = 'cl12345678901234567890123';

const label = {
  id: labelId,
  repositoryId: 'repo-1',
  name: 'bug',
  color: '#FF5733',
  description: 'Bug reports',
  createdAt: new Date('2026-10-08T10:00:00Z'),
  updatedAt: new Date('2026-10-08T10:00:00Z'),
};

describe('Repository label API integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedCreate.mockResolvedValue(label);
    mockedList.mockResolvedValue([label]);
    mockedGet.mockResolvedValue(label);
    mockedUpdate.mockResolvedValue(label);
    mockedDelete.mockResolvedValue(undefined);
  });

  it('creates a label', async () => {
    const response = await request(app).post(base).send({
      name: 'bug',
      color: '#ff5733',
      description: 'Bug reports',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.label.name).toBe('bug');

    expect(mockedCreate).toHaveBeenCalledWith('user-1', 'asil', 'demo', {
      name: 'bug',
      color: '#FF5733',
      description: 'Bug reports',
    });
  });

  it('rejects invalid HEX colors', async () => {
    const response = await request(app).post(base).send({
      name: 'bug',
      color: 'red',
    });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects empty label names', async () => {
    const response = await request(app).post(base).send({
      name: '   ',
      color: '#FF5733',
    });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects unknown creation fields', async () => {
    const response = await request(app).post(base).send({
      name: 'bug',
      color: '#FF5733',
      unexpected: true,
    });

    expect(response.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('lists labels for public access', async () => {
    const response = await request(app).get(base);

    expect(response.status).toBe(200);
    expect(response.body.data.labels).toHaveLength(1);

    expect(mockedList).toHaveBeenCalledWith('asil', 'demo', undefined);
  });

  it('lists labels for authenticated access', async () => {
    const response = await request(app).get(base).set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);

    expect(mockedList).toHaveBeenCalledWith('asil', 'demo', 'user-1');
  });

  it('gets a label by ID', async () => {
    const response = await request(app).get(`${base}/${labelId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.label.id).toBe(labelId);

    expect(mockedGet).toHaveBeenCalledWith('asil', 'demo', labelId, undefined);
  });

  it('rejects invalid label IDs', async () => {
    const response = await request(app).get(`${base}/invalid-id`);

    expect(response.status).toBe(400);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('updates a label', async () => {
    const response = await request(app).patch(`${base}/${labelId}`).send({
      color: '#00ff00',
    });

    expect(response.status).toBe(200);

    expect(mockedUpdate).toHaveBeenCalledWith('user-1', 'asil', 'demo', labelId, {
      color: '#00FF00',
    });
  });

  it('rejects empty label updates', async () => {
    const response = await request(app).patch(`${base}/${labelId}`).send({});

    expect(response.status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('rejects unknown update fields', async () => {
    const response = await request(app).patch(`${base}/${labelId}`).send({ unexpected: true });

    expect(response.status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('deletes a label', async () => {
    const response = await request(app).delete(`${base}/${labelId}`);

    expect(response.status).toBe(204);

    expect(mockedDelete).toHaveBeenCalledWith('user-1', 'asil', 'demo', labelId);
  });
});
