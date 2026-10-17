import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transferFindUnique: vi.fn(),
  repositoryFindUnique: vi.fn(),
  repositoryUpdateMany: vi.fn(),
  transferUpdateMany: vi.fn(),
  transaction: vi.fn(),
  integrityCheck: vi.fn(),
  resolveDestination: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    $transaction: mocks.transaction,
  },
}));

vi.mock('../../../src/services/git/git-repository-transfer-integrity.service.js', () => ({
  verifyGitRepositoryIntegrity: mocks.integrityCheck,
}));

vi.mock('../../../src/utils/git/repository-path.js', () => ({
  resolveOwnedGitRepositoryPath: mocks.resolveDestination,
}));

import { switchRepositoryTransferOwnership } from '../../../src/services/repositories/repository-transfer-ownership.service.js';

const transfer = {
  id: 'transfer-1',
  repositoryId: 'repo-1',
  sourceOwnerId: 'user-1',
  targetOrgId: 'org-1',
  repositoryName: 'demo',
  targetOrgSlug: 'engineering',
  status: 'MOVED',
};

const repository = {
  id: 'repo-1',
  ownerId: 'user-1',
  organizationId: null,
  name: 'demo',
};

beforeEach(() => {
  vi.resetAllMocks();

  mocks.integrityCheck.mockResolvedValue({
    valid: true,
    bare: true,
    fsckPassed: true,
  });
  mocks.resolveDestination.mockReturnValue('/git/engineering/demo.git');

  mocks.transferFindUnique.mockResolvedValue(transfer);
  mocks.repositoryFindUnique.mockResolvedValue(repository);
  mocks.repositoryUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transferUpdateMany.mockResolvedValue({ count: 1 });

  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      repositoryTransfer: {
        findUnique: mocks.transferFindUnique,
        updateMany: mocks.transferUpdateMany,
      },
      repository: {
        findUnique: mocks.repositoryFindUnique,
        updateMany: mocks.repositoryUpdateMany,
      },
    }),
  );
});

describe('Repository transfer ownership switch', () => {
  it('switches ownership and completes transfer', async () => {
    await expect(switchRepositoryTransferOwnership('transfer-1')).resolves.toBeUndefined();

    expect(mocks.repositoryUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'repo-1',
        ownerId: 'user-1',
        organizationId: null,
        name: 'demo',
      },
      data: {
        ownerId: null,
        organizationId: 'org-1',
      },
    });

    expect(mocks.transferUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'transfer-1',
        status: 'MOVED',
      },
      data: {
        status: 'COMPLETED',
      },
    });
  });

  it('rejects a missing transfer', async () => {
    mocks.transferFindUnique.mockResolvedValue(null);

    await expect(switchRepositoryTransferOwnership('transfer-1')).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_NOT_READY',
    });

    expect(mocks.repositoryUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a transfer that is not MOVED', async () => {
    mocks.transferFindUnique.mockResolvedValue({
      ...transfer,
      status: 'MOVING',
    });

    await expect(switchRepositoryTransferOwnership('transfer-1')).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_NOT_READY',
    });

    expect(mocks.repositoryUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects repository ownership changes', async () => {
    mocks.repositoryFindUnique.mockResolvedValue({
      ...repository,
      ownerId: 'another-user',
    });

    await expect(switchRepositoryTransferOwnership('transfer-1')).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_SOURCE_CHANGED',
    });

    expect(mocks.repositoryUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects ownership update conflicts', async () => {
    mocks.repositoryUpdateMany.mockResolvedValue({ count: 0 });

    await expect(switchRepositoryTransferOwnership('transfer-1')).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_OWNERSHIP_CONFLICT',
    });

    expect(mocks.transferUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects transfer completion conflicts', async () => {
    mocks.transferUpdateMany.mockResolvedValue({ count: 0 });

    await expect(switchRepositoryTransferOwnership('transfer-1')).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_COMPLETION_CONFLICT',
    });
  });
  it('verifies destination integrity before changing ownership', async () => {
    await switchRepositoryTransferOwnership('transfer-1');

    expect(mocks.resolveDestination).toHaveBeenCalledWith(
      { type: 'ORGANIZATION', slug: 'engineering' },
      'demo',
    );

    expect(mocks.integrityCheck).toHaveBeenCalledWith('/git/engineering/demo.git');

    expect(mocks.integrityCheck).toHaveBeenCalledOnce();
    expect(mocks.repositoryUpdateMany).toHaveBeenCalledOnce();

    const integrityCallOrder = mocks.integrityCheck.mock.invocationCallOrder[0];
    const ownershipCallOrder = mocks.repositoryUpdateMany.mock.invocationCallOrder[0];

    expect(integrityCallOrder).toBeDefined();
    expect(ownershipCallOrder).toBeDefined();

    expect(integrityCallOrder!).toBeLessThan(ownershipCallOrder!);
  });

  it('rejects invalid destination without changing ownership', async () => {
    mocks.integrityCheck.mockResolvedValue({
      valid: false,
      bare: false,
      fsckPassed: false,
      reason: 'Invalid Git repository',
    });

    await expect(switchRepositoryTransferOwnership('transfer-1')).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_DESTINATION_INTEGRITY_FAILED',
      statusCode: 409,
    });

    expect(mocks.repositoryUpdateMany).not.toHaveBeenCalled();
    expect(mocks.transferUpdateMany).not.toHaveBeenCalled();
  });
});
