import { inspectGitRepositoryTransferRecovery } from '../git/git-repository-transfer-recovery.service.js';

import { listUnfinishedRepositoryTransfers } from './repository-transfer-journal.service.js';

export const inspectUnfinishedRepositoryTransfers = async () => {
  const transfers = await listUnfinishedRepositoryTransfers();

  return Promise.all(
    transfers.map(async (transfer) => {
      const filesystem = await inspectGitRepositoryTransferRecovery({
        sourceUsername: transfer.sourceUsername,
        targetOrgSlug: transfer.targetOrgSlug,
        repositoryName: transfer.repositoryName,
        transferId: transfer.id,
      });

      return {
        transferId: transfer.id,
        repositoryId: transfer.repositoryId,
        status: transfer.status,
        filesystem,
        requiresOperatorReview: true,
      };
    }),
  );
};
