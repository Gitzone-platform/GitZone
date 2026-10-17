import { AppError } from '../../errors/app.error.js';
import {
  withGitDistributedLocks,
} from '../git/git-distributed-lock.service.js';
import {
  prepareGitRepositoryTransfer,
} from '../git/git-repository-transfer-filesystem.service.js';
import {
  verifyGitRepositoryIntegrity,
} from '../git/git-repository-transfer-integrity.service.js';
import {
  withGitNamespacePairWriteLock,
} from '../git/git-user-lock.service.js';
import {
  resolveGitRepositoryPath,
} from '../../utils/git/repository-path.js';
import {
  authorizeRepositoryTransfer,
  advanceRepositoryTransferState,
} from './repository-transfer-control.service.js';
import {
  createRepositoryTransferJournal,
  type CreateRepositoryTransferInput,
} from './repository-transfer-journal.service.js';
import {
  switchRepositoryTransferOwnership,
} from './repository-transfer-ownership.service.js';

export type PrepareRepositoryTransferInput =
  CreateRepositoryTransferInput & {
    actorId: string;
  };

const assertLockAlive = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new AppError(
      'Git transfer distributed lock connection lost',
      503,
      'GIT_TRANSFER_LOCK_LOST',
    );
  }
};

/**
 * Executes the transfer under local and PostgreSQL namespace write locks.
 *
 * This operation remains private until distributed-lock failure handling,
 * filesystem recovery and the public API are fully verified.
 */
export const prepareRepositoryTransferOrchestration = async (
  input: PrepareRepositoryTransferInput,
): Promise<{ transferId: string; status: 'COMPLETED' }> =>
  withGitNamespacePairWriteLock(
    { type: 'USER', id: input.sourceOwnerId },
    { type: 'ORGANIZATION', id: input.targetOrgId },
    async () =>
      withGitDistributedLocks(
        [
          { type: 'USER', id: input.sourceOwnerId },
          { type: 'ORGANIZATION', id: input.targetOrgId },
        ],
        'write',
        async ({ signal }) => {
          assertLockAlive(signal);

          await authorizeRepositoryTransfer(
            input.repositoryId,
            input.actorId,
            input.targetOrgId,
          );

          if (input.actorId !== input.sourceOwnerId) {
            throw new AppError(
              'Transfer actor does not match repository owner',
              403,
              'REPOSITORY_TRANSFER_ACTOR_MISMATCH',
            );
          }

          assertLockAlive(signal);

          const journal = await createRepositoryTransferJournal(input);

          await advanceRepositoryTransferState(
            journal.id,
            'PENDING',
            'MOVING',
          );

          assertLockAlive(signal);

          const source = await verifyGitRepositoryIntegrity(
            resolveGitRepositoryPath(
              input.sourceUsername,
              input.repositoryName,
            ),
          );

          if (!source.valid) {
            throw new AppError(
              'Source Git repository failed integrity verification',
              409,
              'REPOSITORY_TRANSFER_SOURCE_INTEGRITY_FAILED',
            );
          }

          assertLockAlive(signal);

          const paths = await prepareGitRepositoryTransfer(
            input.sourceUsername,
            input.targetOrgSlug,
            input.repositoryName,
            journal.id,
          );

          assertLockAlive(signal);

          const destination = await verifyGitRepositoryIntegrity(
            paths.destinationPath,
          );

          if (!destination.valid) {
            throw new AppError(
              'Destination Git repository failed integrity verification',
              409,
              'REPOSITORY_TRANSFER_DESTINATION_INTEGRITY_FAILED',
            );
          }

          assertLockAlive(signal);

          await advanceRepositoryTransferState(
            journal.id,
            'MOVING',
            'MOVED',
          );

          assertLockAlive(signal);

          await switchRepositoryTransferOwnership(journal.id);

          assertLockAlive(signal);

          return {
            transferId: journal.id,
            status: 'COMPLETED',
          };
        },
      ),
  );