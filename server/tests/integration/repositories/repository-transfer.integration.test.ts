import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findRepository: vi.fn(),
  findOrganization: vi.fn(),
  orchestrate: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: { findFirst: mocks.findRepository },
    organization: { findUnique: mocks.findOrganization },
  },
}));

vi.mock(
  '../../../src/services/repositories/repository-transfer-orchestrator.service.js',
  () => ({
    prepareRepositoryTransferOrchestration: mocks.orchestrate,
  }),
);

import { transferRepositoryToOrganization } from '../../../src/controllers/repositories/repository-transfer.controller.js';

const makeRequest = (
  body: unknown = { organizationSlug: 'team' },
  userId = 'user-1',
): Request =>
  ({
    params: { username: 'alice', name: 'project' },
    body,
    userId,
  }) as unknown as Request;

const makeResponse = () => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });

  return {
    response: { status } as unknown as Response,
    status,
    json,
  };
};

beforeEach(() => {
  vi.resetAllMocks();

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

describe('Repository transfer API controller', () => {
  it('rejects invalid request bodies', async () => {
    const { response } = makeResponse();

    await expect(
      transferRepositoryToOrganization(
        makeRequest({ organizationSlug: '' }),
        response,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_REPOSITORY_TRANSFER_DATA',
    });

    expect(mocks.findRepository).not.toHaveBeenCalled();
    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('rejects extra request fields', async () => {
    const { response } = makeResponse();

    await expect(
      transferRepositoryToOrganization(
        makeRequest({ organizationSlug: 'team', actorId: 'admin' }),
        response,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_REPOSITORY_TRANSFER_DATA',
    });

    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('rejects transfers by non-owners', async () => {
    const { response } = makeResponse();

    await expect(
      transferRepositoryToOrganization(
        makeRequest({ organizationSlug: 'team' }, 'attacker'),
        response,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_TRANSFER_NOT_OWNER',
    });

    expect(mocks.findOrganization).not.toHaveBeenCalled();
    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('rejects unknown repositories', async () => {
    mocks.findRepository.mockResolvedValue(null);

    const { response } = makeResponse();

    await expect(
      transferRepositoryToOrganization(makeRequest(), response),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('rejects unknown destination organizations', async () => {
    mocks.findOrganization.mockResolvedValue(null);

    const { response } = makeResponse();

    await expect(
      transferRepositoryToOrganization(makeRequest(), response),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });

    expect(mocks.orchestrate).not.toHaveBeenCalled();
  });

  it('passes trusted database identities to the orchestrator', async () => {
    const { response, status, json } = makeResponse();

    await transferRepositoryToOrganization(makeRequest(), response);

    expect(mocks.orchestrate).toHaveBeenCalledExactlyOnceWith({
      repositoryId: 'repository-1',
      actorId: 'user-1',
      sourceOwnerId: 'user-1',
      sourceUsername: 'alice',
      targetOrgId: 'organization-1',
      targetOrgSlug: 'team',
      repositoryName: 'project',
    });

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        transferId: 'cmtransferjournal00000001',
        status: 'COMPLETED',
      },
    });
  });

  it('does not report success when orchestration fails', async () => {
    mocks.orchestrate.mockRejectedValue(
      new Error('Transfer failed'),
    );

    const { response, status } = makeResponse();

    await expect(
      transferRepositoryToOrganization(makeRequest(), response),
    ).rejects.toThrow('Transfer failed');

    expect(status).not.toHaveBeenCalled();
  });
});
