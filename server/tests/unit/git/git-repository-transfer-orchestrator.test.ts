import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  distributedLock: vi.fn(),
  authorize: vi.fn(),
  createJournal: vi.fn(),
  advance: vi.fn(),
  integrity: vi.fn(),
  prepare: vi.fn(),
  sourcePath: vi.fn(),
  switchOwnership: vi.fn(),
  abortController: null as AbortController | null,
}));

vi.mock('../../../src/services/git/git-user-lock.service.js', () => ({
  withGitNamespacePairWriteLock: mocks.lock,
}));

vi.mock('../../../src/services/git/git-distributed-lock.service.js', () => ({
  withGitDistributedLocks: mocks.distributedLock,
}));

vi.mock('../../../src/services/repositories/repository-transfer-control.service.js', () => ({
  authorizeRepositoryTransfer: mocks.authorize,
  advanceRepositoryTransferState: mocks.advance,
}));

vi.mock('../../../src/services/repositories/repository-transfer-journal.service.js', () => ({
  createRepositoryTransferJournal: mocks.createJournal,
}));

vi.mock('../../../src/services/git/git-repository-transfer-integrity.service.js', () => ({
  verifyGitRepositoryIntegrity: mocks.integrity,
}));

vi.mock('../../../src/services/git/git-repository-transfer-filesystem.service.js', () => ({
  prepareGitRepositoryTransfer: mocks.prepare,
}));

vi.mock('../../../src/utils/git/repository-path.js', () => ({
  resolveGitRepositoryPath: mocks.sourcePath,
}));

vi.mock('../../../src/services/repositories/repository-transfer-ownership.service.js', () => ({
  switchRepositoryTransferOwnership: mocks.switchOwnership,
}));

import { prepareRepositoryTransferOrchestration } from '../../../src/services/repositories/repository-transfer-orchestrator.service.js';

const input = {
  repositoryId: 'repo-id',
  sourceOwnerId: 'alice-id',
  sourceUsername: 'alice',
  targetOrgId: 'org-id',
  targetOrgSlug: 'team',
  repositoryName: 'project',
  actorId: 'alice-id',
};

beforeEach(() => {
  vi.resetAllMocks();

  const controller = new AbortController();
  mocks.abortController = controller;

  mocks.lock.mockImplementation(async (_first, _second, operation: () => Promise<unknown>) =>
    operation(),
  );

  mocks.distributedLock.mockImplementation(
    async (_owners, _mode, operation: (context: { signal: AbortSignal }) => Promise<unknown>) =>
      operation({ signal: controller.signal }),
  );

  mocks.authorize.mockResolvedValue(undefined);
  mocks.createJournal.mockResolvedValue({ id: 'transfer-id' });
  mocks.advance.mockResolvedValue(undefined);
  mocks.switchOwnership.mockResolvedValue(undefined);
  mocks.sourcePath.mockReturnValue('/source/project.git');

  mocks.prepare.mockResolvedValue({
    sourcePath: '/source/project.git',
    destinationPath: '/destination/project.git',
    stagingPath: '/destination/.transfer-transfer-id',
    transferId: 'transfer-id',
  });

  mocks.integrity.mockResolvedValue({
    valid: true,
    bare: true,
    fsckPassed: true,
    reason: null,
  });
});

describe('Repository transfer orchestration', () => {
  it('completes transfer under local and distributed locks', async () => {
    await expect(prepareRepositoryTransferOrchestration(input)).resolves.toEqual({
      transferId: 'transfer-id',
      status: 'COMPLETED',
    });

    expect(mocks.lock).toHaveBeenCalledOnce();

    expect(mocks.distributedLock).toHaveBeenCalledWith(
      [
        { type: 'USER', id: 'alice-id' },
        { type: 'ORGANIZATION', id: 'org-id' },
      ],
      'write',
      expect.any(Function),
    );

    expect(mocks.authorize).toHaveBeenCalledWith('repo-id', 'alice-id', 'org-id');

    expect(mocks.advance).toHaveBeenNthCalledWith(1, 'transfer-id', 'PENDING', 'MOVING');

    expect(mocks.advance).toHaveBeenNthCalledWith(2, 'transfer-id', 'MOVING', 'MOVED');

    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.integrity).toHaveBeenCalledTimes(2);
    expect(mocks.switchOwnership).toHaveBeenCalledWith('transfer-id');
  });

  it('rejects unauthorized actors before creating a journal', async () => {
    mocks.authorize.mockRejectedValue(new Error('Forbidden'));

    await expect(prepareRepositoryTransferOrchestration(input)).rejects.toThrow('Forbidden');

    expect(mocks.createJournal).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.switchOwnership).not.toHaveBeenCalled();
  });

  it('rejects a source repository that fails integrity verification', async () => {
    mocks.integrity.mockResolvedValueOnce({
      valid: false,
      bare: false,
      fsckPassed: false,
      reason: 'INVALID_GIT_REPOSITORY',
    });

    await expect(prepareRepositoryTransferOrchestration(input)).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_SOURCE_INTEGRITY_FAILED',
    });

    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.switchOwnership).not.toHaveBeenCalled();
  });

  it('rejects a destination repository that fails integrity verification', async () => {
    mocks.integrity
      .mockResolvedValueOnce({
        valid: true,
        bare: true,
        fsckPassed: true,
        reason: null,
      })
      .mockResolvedValueOnce({
        valid: false,
        bare: true,
        fsckPassed: false,
        reason: 'GIT_FSCK_FAILED',
      });

    await expect(prepareRepositoryTransferOrchestration(input)).rejects.toMatchObject({
      code: 'REPOSITORY_TRANSFER_DESTINATION_INTEGRITY_FAILED',
    });

    expect(mocks.advance).toHaveBeenCalledTimes(1);
    expect(mocks.switchOwnership).not.toHaveBeenCalled();
  });

  it('stops before filesystem preparation when journal transition fails', async () => {
    mocks.advance.mockRejectedValueOnce(new Error('State conflict'));

    await expect(prepareRepositoryTransferOrchestration(input)).rejects.toThrow('State conflict');

    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.switchOwnership).not.toHaveBeenCalled();
  });

  it('does not switch ownership when distributed lock is lost', async () => {
    mocks.advance.mockImplementation(async (_id: string, _from: string, to: string) => {
      if (to === 'MOVED') {
        mocks.abortController?.abort();
      }
    });

    await expect(prepareRepositoryTransferOrchestration(input)).rejects.toMatchObject({
      code: 'GIT_TRANSFER_LOCK_LOST',
    });

    expect(mocks.switchOwnership).not.toHaveBeenCalled();
  });

  it('does not create a journal if the lock is already aborted', async () => {
    mocks.abortController?.abort();

    await expect(prepareRepositoryTransferOrchestration(input)).rejects.toMatchObject({
      code: 'GIT_TRANSFER_LOCK_LOST',
    });

    expect(mocks.createJournal).not.toHaveBeenCalled();
  });

  it('propagates ownership switch failures', async () => {
    mocks.switchOwnership.mockRejectedValue(new Error('Ownership switch failed'));

    await expect(prepareRepositoryTransferOrchestration(input)).rejects.toThrow(
      'Ownership switch failed',
    );

    expect(mocks.advance).toHaveBeenCalledTimes(2);
  });
});
