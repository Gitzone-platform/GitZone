import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repositoryTransfer: {
      findFirst: mocks.findFirst,
    },
  },
}));

import {
  assertRepositoryTransferAllowsGitWrite,
} from '../../../src/services/repositories/repository-transfer-write-guard.service.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findFirst.mockResolvedValue(null);
});

describe('Repository transfer Git write guard', () => {
  it('allows writes when no active transfer exists', async () => {
    await expect(
      assertRepositoryTransferAllowsGitWrite('repo-id'),
    ).resolves.toBeUndefined();

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        repositoryId: 'repo-id',
        status: {
          in: ['PENDING', 'MOVING', 'MOVED'],
        },
      },
      select: { id: true },
    });
  });

  it('blocks writes during an active transfer', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'transfer-id' });

    await expect(
      assertRepositoryTransferAllowsGitWrite('repo-id'),
    ).rejects.toMatchObject({
      code: 'GIT_REPOSITORY_TRANSFER_WRITE_BLOCKED',
      statusCode: 409,
    });
  });

  it('fails closed when the database is unavailable', async () => {
    mocks.findFirst.mockRejectedValue(
      new Error('Database unavailable'),
    );

    await expect(
      assertRepositoryTransferAllowsGitWrite('repo-id'),
    ).rejects.toThrow('Database unavailable');
  });

  it('allows writes when no unfinished transfer is returned', async () => {
    mocks.findFirst.mockResolvedValue(null);

    await assertRepositoryTransferAllowsGitWrite('repo-id');

    expect(mocks.findFirst).toHaveBeenCalledOnce();
  });
});
