import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  instances: [] as EventEmitter[],
}));

vi.mock('pg', () => ({
  Client: class extends EventEmitter {
    constructor() {
      super();
      mocks.instances.push(this);
    }

    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));

vi.mock('../../../src/config/env.js', () => ({
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  },
}));

import {
  withGitDistributedLock,
  withGitDistributedLocks,
} from '../../../src/services/git/git-distributed-lock.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.instances.length = 0;
  mocks.connect.mockResolvedValue(undefined);
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.end.mockResolvedValue(undefined);
});

describe('Git distributed advisory lock', () => {
  it('acquires a shared lock and closes the session', async () => {
    const result = await withGitDistributedLock(
      { type: 'USER', id: 'alice-id' },
      'read',
      async () => 'ok',
    );

    expect(result).toBe('ok');
    expect(mocks.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_lock_shared($1::bigint)',
      [expect.any(String)],
    );
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('closes the session when operation fails', async () => {
    await expect(
      withGitDistributedLock(
        { type: 'ORGANIZATION', id: 'org-id' },
        'write',
        async () => {
          throw new Error('operation failed');
        },
      ),
    ).rejects.toThrow('operation failed');

    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('sorts and deduplicates multiple namespace locks', async () => {
    await withGitDistributedLocks(
      [
        { type: 'USER', id: 'alice-id' },
        { type: 'ORGANIZATION', id: 'org-id' },
        { type: 'USER', id: 'alice-id' },
      ],
      'write',
      async () => 'ok',
    );

    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('aborts an operation when the database connection is lost', async () => {
    await expect(
      withGitDistributedLock(
        { type: 'USER', id: 'alice-id' },
        'read',
        async ({ signal }) => {
          mocks.instances[0]?.emit('error', new Error('connection lost'));

          expect(signal.aborted).toBe(true);

          return 'unsafe-result';
        },
      ),
    ).rejects.toThrow('Git distributed lock connection lost');
  });

  it('does not start an operation when lock acquisition fails', async () => {
    mocks.query.mockRejectedValueOnce(new Error('lock failed'));

    const operation = vi.fn(async () => 'ok');

    await expect(
      withGitDistributedLock(
        { type: 'USER', id: 'alice-id' },
        'write',
        operation,
      ),
    ).rejects.toThrow('lock failed');

    expect(operation).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});