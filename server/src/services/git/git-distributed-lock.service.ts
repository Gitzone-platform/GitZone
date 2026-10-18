import { createHash } from 'node:crypto';
import { Client } from 'pg';

import { env } from '../../config/env.js';

export type GitDistributedLockMode = 'read' | 'write';

export type GitDistributedLockOwner = {
  type: 'USER' | 'ORGANIZATION';
  id: string;
};

export type GitDistributedLockContext = {
  signal: AbortSignal;
};

const lockKey = (owner: GitDistributedLockOwner): bigint => {
  if (!owner.id) {
    throw new Error('Git lock owner ID is required');
  }

  const digest = createHash('sha256').update(`gitzone:git:${owner.type}:${owner.id}`).digest();

  return digest.readBigInt64BE(0);
};

const lockIdentity = (owner: GitDistributedLockOwner): string => `${owner.type}:${owner.id}`;

export const withGitDistributedLocks = async <T>(
  owners: readonly GitDistributedLockOwner[],
  mode: GitDistributedLockMode,
  operation: (context: GitDistributedLockContext) => Promise<T>,
): Promise<T> => {
  if (owners.length === 0) {
    throw new Error('At least one Git lock owner is required');
  }

  const uniqueOwners = [
    ...new Map(owners.map((owner) => [lockIdentity(owner), owner])).values(),
  ].sort((a, b) => lockIdentity(a).localeCompare(lockIdentity(b)));

  const client = new Client({
    connectionString: env.DATABASE_URL,
  });

  const controller = new AbortController();
  const onConnectionLost = (): void => {
    controller.abort();
  };

  client.on('error', onConnectionLost);
  client.on('end', onConnectionLost);

  try {
    await client.connect();

    for (const owner of uniqueOwners) {
      if (controller.signal.aborted) {
        throw new Error('Git distributed lock connection lost');
      }

      const query =
        mode === 'read'
          ? 'SELECT pg_advisory_lock_shared($1::bigint)'
          : 'SELECT pg_advisory_lock($1::bigint)';

      await client.query(query, [lockKey(owner).toString()]);
    }

    if (controller.signal.aborted) {
      throw new Error('Git distributed lock connection lost');
    }

    const result = await operation({ signal: controller.signal });

    if (controller.signal.aborted) {
      throw new Error('Git distributed lock connection lost');
    }

    return result;
  } finally {
    client.removeListener('error', onConnectionLost);
    client.removeListener('end', onConnectionLost);

    try {
      await client.end();
    } catch {
      // Do not mask an error from the operation.
      // The dedicated connection must not be reused.
    }
  }
};

export const withGitDistributedLock = async <T>(
  owner: GitDistributedLockOwner,
  mode: GitDistributedLockMode,
  operation: (context: GitDistributedLockContext) => Promise<T>,
): Promise<T> => withGitDistributedLocks([owner], mode, operation);
