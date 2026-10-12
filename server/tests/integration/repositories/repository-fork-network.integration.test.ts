import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { getRepositoryForkNetwork } from '../../../src/services/repositories/repository-fork-network.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-fork-network.service.js', () => ({
  getRepositoryForkNetwork: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token !== 'test-access-token') {
      throw new Error('Invalid token');
    }

    return { sub: 'user-1' };
  }),
}));

const mockedNetwork = vi.mocked(getRepositoryForkNetwork);
const url = '/api/repositories/alice/project/forks/network';

const network = {
  repositoryId: 'repo-1',
  isFork: false,
  parent: null,
  parentAccessible: null,
  forkCount: 1,
  totalForkCount: 1,
  forks: [{ id: 'fork-1', name: 'copy', owner: 'bob' }],
  hasMore: false,
};

describe('repository fork network HTTP integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedNetwork.mockResolvedValue(network);
  });

  it('returns public fork network without authentication', async () => {
    const response = await request(app).get(url);

    expect(response.status).toBe(200);
    expect(response.body.data.network).toMatchObject(network);
    expect(mockedNetwork).toHaveBeenCalledWith(
      'alice',
      'project',
      undefined,
    );
  });

  it('passes authenticated user to service', async () => {
    const response = await request(app)
      .get(url)
      .set('Authorization', 'Bearer test-access-token');

    expect(response.status).toBe(200);
    expect(mockedNetwork).toHaveBeenCalledWith(
      'alice',
      'project',
      'user-1',
    );
  });

  it('returns 404 for missing repository', async () => {
    mockedNetwork.mockRejectedValue(
      new AppError('Not found', 404, 'REPOSITORY_NOT_FOUND'),
    );

    const response = await request(app).get(url);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('REPOSITORY_NOT_FOUND');
  });

  it('returns 403 when repository access is denied', async () => {
    mockedNetwork.mockRejectedValue(
      new AppError('Forbidden', 403, 'REPOSITORY_ACCESS_DENIED'),
    );

    const response = await request(app).get(url);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('REPOSITORY_ACCESS_DENIED');
  });
});
