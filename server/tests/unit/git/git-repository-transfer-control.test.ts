import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findRepository: vi.fn(),
  findMembership: vi.fn(),
  updateTransfer: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findUnique: mocks.findRepository,
    },
    organizationMember: {
      findUnique: mocks.findMembership,
    },
    repositoryTransfer: {
      updateMany: mocks.updateTransfer,
    },
  },
}));

import {
  advanceRepositoryTransferState,
  authorizeRepositoryTransfer,
} from '../../../src/services/repositories/repository-transfer-control.service.js';

beforeEach(() => {
  vi.clearAllMocks();

  mocks.findRepository.mockResolvedValue({
    ownerId: 'alice-id',
    organizationId: null,
  });

  mocks.findMembership.mockResolvedValue({
    role: 'OWNER',
  });

  mocks.updateTransfer.mockResolvedValue({
    count: 1,
  });
});

describe('Repository transfer authorization', () => {
  it('allows a personal repository owner who owns the organization', async () => {
    await expect(
      authorizeRepositoryTransfer(
        'repo-id',
        'alice-id',
        'org-id',
      ),
    ).resolves.toBeUndefined();

    expect(mocks.findRepository).toHaveBeenCalledWith({
      where: { id: 'repo-id' },
      select: {
        ownerId: true,
        organizationId: true,
      },
    });

    expect(mocks.findMembership).toHaveBeenCalledWith({
      where: {
        organizationId_userId: {
          organizationId: 'org-id',
          userId: 'alice-id',
        },
      },
      select: { role: true },
    });
  });

  it('rejects a different repository owner', async () => {
    mocks.findRepository.mockResolvedValue({
      ownerId: 'bob-id',
      organizationId: null,
    });

    await expect(
      authorizeRepositoryTransfer(
        'repo-id',
        'alice-id',
        'org-id',
      ),
    ).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_NOT_OWNER',
    });
  });

  it('rejects organization members without OWNER permission', async () => {
    mocks.findMembership.mockResolvedValue({
      role: 'MEMBER',
    });

    await expect(
      authorizeRepositoryTransfer(
        'repo-id',
        'alice-id',
        'org-id',
      ),
    ).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_ORG_OWNER_REQUIRED',
    });
  });

  it('rejects repositories already owned by an organization', async () => {
    mocks.findRepository.mockResolvedValue({
      ownerId: null,
      organizationId: 'another-org',
    });

    await expect(
      authorizeRepositoryTransfer(
        'repo-id',
        'alice-id',
        'org-id',
      ),
    ).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_NOT_OWNER',
    });
  });
});

describe('Repository transfer state transitions', () => {
  it('allows PENDING to MOVING', async () => {
    await advanceRepositoryTransferState(
      'transfer-id',
      'PENDING',
      'MOVING',
    );

    expect(mocks.updateTransfer).toHaveBeenCalledWith({
      where: {
        id: 'transfer-id',
        status: 'PENDING',
      },
      data: {
        status: 'MOVING',
        lastError: null,
      },
    });
  });

  it('allows MOVING to MOVED', async () => {
    await expect(
      advanceRepositoryTransferState(
        'transfer-id',
        'MOVING',
        'MOVED',
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects invalid state transitions', async () => {
    await expect(
      advanceRepositoryTransferState(
        'transfer-id',
        'PENDING',
        'COMPLETED',
      ),
    ).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_INVALID_TRANSITION',
    });

    expect(mocks.updateTransfer).not.toHaveBeenCalled();
  });

  it('rejects concurrent state changes', async () => {
    mocks.updateTransfer.mockResolvedValue({
      count: 0,
    });

    await expect(
      advanceRepositoryTransferState(
        'transfer-id',
        'MOVING',
        'MOVED',
      ),
    ).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_STATE_CONFLICT',
    });
  });
});
