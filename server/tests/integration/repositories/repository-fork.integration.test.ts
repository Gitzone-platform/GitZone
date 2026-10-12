import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { forkRepository } from '../../../src/services/repositories/repository-fork.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-fork.service.js', () => ({
  forkRepository: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token !== 'test-access-token') {
      throw new Error('Invalid token');
    }

    return { sub: 'forker-1' };
  }),
}));

const mockedFork = vi.mocked(forkRepository);
const url = '/api/repositories/sourceowner/project/fork';

const repository = {
  id: 'fork-1',
  ownerId: 'forker-1',
  name: 'project',
  description: 'Forked repository',
  isPrivate: false,
  defaultBranch: 'main',
  forkedFromId: 'source-1',
  createdAt: new Date('2026-10-12T00:00:00.000Z'),
  updatedAt: new Date('2026-10-12T00:00:00.000Z'),
};

const authenticated = () =>
  request(app)
    .post(url)
    .set('Authorization', 'Bearer test-access-token');

describe('repository fork HTTP integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedFork.mockResolvedValue(repository);
  });

  it('creates a fork and returns 201', async () => {
    const response = await authenticated().send({});

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        repository: {
          id: 'fork-1',
          ownerId: 'forker-1',
          name: 'project',
          forkedFromId: 'source-1',
        },
      },
    });

    expect(mockedFork).toHaveBeenCalledExactlyOnceWith(
      'forker-1',
      'sourceowner',
      'project',
      {},
    );
  });

  it('passes custom fork settings to service', async () => {
    const input = {
      name: 'project-copy',
      description: 'My fork',
      isPrivate: true,
    };

    const response = await authenticated().send(input);

    expect(response.status).toBe(201);

    expect(mockedFork).toHaveBeenCalledExactlyOnceWith(
      'forker-1',
      'sourceowner',
      'project',
      input,
    );
  });

  it('requires authentication', async () => {
    const response = await request(app).post(url).send({});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHORIZATION_REQUIRED');
    expect(mockedFork).not.toHaveBeenCalled();
  });

  it('rejects invalid access tokens', async () => {
    const response = await request(app)
      .post(url)
      .set('Authorization', 'Bearer invalid-token')
      .send({});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_ACCESS_TOKEN');
    expect(mockedFork).not.toHaveBeenCalled();
  });

  it('rejects malformed authorization headers', async () => {
    const response = await request(app)
      .post(url)
      .set('Authorization', 'Basic test-access-token')
      .send({});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_AUTHORIZATION_HEADER');
    expect(mockedFork).not.toHaveBeenCalled();
  });

  it('rejects invalid repository names', async () => {
    const response = await authenticated().send({
      name: '../invalid',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_FORK_DATA');
    expect(mockedFork).not.toHaveBeenCalled();
  });

  it('rejects unexpected request fields', async () => {
    const response = await authenticated().send({
      unknownField: true,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_FORK_DATA');
    expect(mockedFork).not.toHaveBeenCalled();
  });

  it('rejects invalid visibility values', async () => {
    const response = await authenticated().send({
      isPrivate: 'false',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_FORK_DATA');
    expect(mockedFork).not.toHaveBeenCalled();
  });

  it('returns 404 when source repository is missing', async () => {
    mockedFork.mockRejectedValue(
      new AppError('Not found', 404, 'REPOSITORY_NOT_FOUND'),
    );

    const response = await authenticated().send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('REPOSITORY_NOT_FOUND');
  });

  it('returns 403 when private source access is denied', async () => {
    mockedFork.mockRejectedValue(
      new AppError('Access denied', 403, 'REPOSITORY_ACCESS_DENIED'),
    );

    const response = await authenticated().send({});

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('REPOSITORY_ACCESS_DENIED');
  });

  it('rejects private-to-public fork visibility', async () => {
    mockedFork.mockRejectedValue(
      new AppError('Visibility denied', 403, 'FORK_VISIBILITY_DENIED'),
    );

    const response = await authenticated().send({
      isPrivate: false,
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORK_VISIBILITY_DENIED');
  });

  it('returns 409 for self-collision', async () => {
    mockedFork.mockRejectedValue(
      new AppError('Self collision', 409, 'FORK_SELF_COLLISION'),
    );

    const response = await authenticated().send({});

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('FORK_SELF_COLLISION');
  });

  it('returns 409 for existing target repository', async () => {
    mockedFork.mockRejectedValue(
      new AppError('Already exists', 409, 'REPOSITORY_ALREADY_EXISTS'),
    );

    const response = await authenticated().send({});

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('REPOSITORY_ALREADY_EXISTS');
  });

  it('returns 409 for occupied Git destination', async () => {
    mockedFork.mockRejectedValue(
      new AppError('Git destination exists', 409, 'GIT_REPOSITORY_ALREADY_EXISTS'),
    );

    const response = await authenticated().send({});

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('GIT_REPOSITORY_ALREADY_EXISTS');
  });

  it('returns 500 for Git clone failures', async () => {
    mockedFork.mockRejectedValue(
      new AppError('Clone failed', 500, 'GIT_FORK_CLONE_FAILED'),
    );

    const response = await authenticated().send({});

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('GIT_FORK_CLONE_FAILED');
  });

  it('returns 500 for rollback failures', async () => {
    mockedFork.mockRejectedValue(
      new AppError('Rollback failed', 500, 'FORK_ROLLBACK_FAILED'),
    );

    const response = await authenticated().send({});

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('FORK_ROLLBACK_FAILED');
  });
});
