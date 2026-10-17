import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  findRepository: vi.fn(),
  findOrganization: vi.fn(),
  orchestrate: vi.fn(),
}));

vi.mock('../../../src/utils/auth/tokens.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../src/utils/auth/tokens.js')>();

  return {
    ...original,
    verifyAccessToken: mocks.verifyToken,
  };
});

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: mocks.findRepository,
    },
    organization: {
      findUnique: mocks.findOrganization,
    },
  },
}));

vi.mock(
  '../../../src/services/repositories/repository-transfer-orchestrator.service.js',
  () => ({
    prepareRepositoryTransferOrchestration: mocks.orchestrate,
  }),
);

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

import app from '../../../src/app.js';

const endpoint = '/api/repositories/alice/project/transfer';

beforeEach(() => {
  vi.resetAllMocks();

  mocks.verifyToken.mockReturnValue({
    sub: 'user-1',
  });

  mocks.findRepository.mockResolvedValue({
    id: 'repository-1',
    name: 'project',
    ownerId: 'user-1',
    owner: { username: 'alice' },
  });

  mocks.findOrganization.mockResolvedValue({
    id: 'organization-1',
    slug: 'team',
  });

  mocks.orchestrate.mockResolvedValue({
    transferId: 'cmtransferjournal00000001',
    status: 'COMPLETED',
  });
});

describe('Repository transfer HTTP API', () => {
  it('returns 401 when authorization header is missing', async () => {
    const response = await request(app)
      .post(endpoint)
      .send({ organizationSlug: 'team' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'AUTHORIZATION_REQUIRED' },
    });

    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid bearer token', async () => {
    mocks.verifyToken.mockImplementation(() => {
      throw new Error('Invalid token');
    });

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer invalid')
      .send({ organizationSlug: 'team' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_ACCESS_TOKEN' },
    });

    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid transfer input', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer valid')
      .send({ organizationSlug: '', actorId: 'admin' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_REPOSITORY_TRANSFER_DATA' },
    });

    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user is not the repository owner', async () => {
    mocks.verifyToken.mockReturnValue({ sub: 'attacker' });

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer valid')
      .send({ organizationSlug: 'team' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'REPOSITORY_TRANSFER_NOT_OWNER' },
    });

    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('returns 404 when the repository does not exist', async () => {
    mocks.findRepository.mockResolvedValue(null);

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer valid')
      .send({ organizationSlug: 'team' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'REPOSITORY_NOT_FOUND' },
    });

    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('returns 404 when the organization does not exist', async () => {
    mocks.findOrganization.mockResolvedValue(null);

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer valid')
      .send({ organizationSlug: 'missing' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'ORGANIZATION_NOT_FOUND' },
    });

    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('returns 200 only after orchestration completes', async () => {
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer valid')
      .send({ organizationSlug: 'team' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        transferId: 'cmtransferjournal00000001',
        status: 'COMPLETED',
      },
    });

    expect(mocks.orchestrate).toHaveBeenCalledExactlyOnceWith({
      repositoryId: 'repository-1',
      actorId: 'user-1',
      sourceOwnerId: 'user-1',
      sourceUsername: 'alice',
      targetOrgId: 'organization-1',
      targetOrgSlug: 'team',
      repositoryName: 'project',
    });
  });

  it('does not return success when transfer orchestration fails', async () => {
    mocks.orchestrate.mockRejectedValue(
      new Error('Transfer operation failed'),
    );

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer valid')
      .send({ organizationSlug: 'team' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
    });
  });
});
