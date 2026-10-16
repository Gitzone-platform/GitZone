import { describe, expect, it } from 'vitest';

import {
  withGitNamespaceReadLock,
  withGitNamespaceWriteLock,
  withGitUserWriteLock,
} from '../../../src/services/git/git-user-lock.service.js';

const deferred = () => {
  let release!: () => void;

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
};

describe('Git namespace locks', () => {
  it('shares the legacy user lock', async () => {
    const started = deferred();
    const unblock = deferred();

    const writer = withGitUserWriteLock('user-1', async () => {
      started.release();
      await unblock.promise;
    });

    await started.promise;

    let readerStarted = false;

    const reader = withGitNamespaceReadLock(
      { type: 'USER', id: 'user-1' },
      async () => {
        readerStarted = true;
      },
    );

    expect(readerStarted).toBe(false);

    unblock.release();

    await Promise.all([writer, reader]);

    expect(readerStarted).toBe(true);
  });

  it('serializes organization writes', async () => {
    const started = deferred();
    const unblock = deferred();

    const first = withGitNamespaceWriteLock(
      { type: 'ORGANIZATION', id: 'org-1' },
      async () => {
        started.release();
        await unblock.promise;
      },
    );

    await started.promise;

    let secondStarted = false;

    const second = withGitNamespaceWriteLock(
      { type: 'ORGANIZATION', id: 'org-1' },
      async () => {
        secondStarted = true;
      },
    );

    expect(secondStarted).toBe(false);

    unblock.release();

    await Promise.all([first, second]);

    expect(secondStarted).toBe(true);
  });

  it('keeps organization locks independent from user locks', async () => {
    const started = deferred();
    const unblock = deferred();

    const userWriter = withGitUserWriteLock('same-id', async () => {
      started.release();
      await unblock.promise;
    });

    await started.promise;

    let organizationStarted = false;

    await withGitNamespaceReadLock(
      { type: 'ORGANIZATION', id: 'same-id' },
      async () => {
        organizationStarted = true;
      },
    );

    expect(organizationStarted).toBe(true);

    unblock.release();
    await userWriter;
  });

  it('releases organization locks after an exception', async () => {
    await expect(
      withGitNamespaceWriteLock(
        { type: 'ORGANIZATION', id: 'org-error' },
        async () => {
          throw new Error('expected failure');
        },
      ),
    ).rejects.toThrow('expected failure');

    let acquired = false;

    await withGitNamespaceReadLock(
      { type: 'ORGANIZATION', id: 'org-error' },
      async () => {
        acquired = true;
      },
    );

    expect(acquired).toBe(true);
  });

  it('rejects an empty namespace owner ID', async () => {
    await expect(
      withGitNamespaceReadLock(
        { type: 'ORGANIZATION', id: '' },
        async () => undefined,
      ),
    ).rejects.toThrow('Git namespace owner ID is required');
  });
});