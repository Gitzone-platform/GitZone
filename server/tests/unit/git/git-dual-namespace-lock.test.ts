import { describe, expect, it } from 'vitest';

import {
  withGitNamespacePairWriteLock,
  withGitNamespaceWriteLock,
} from '../../../src/services/git/git-user-lock.service.js';

describe('dual namespace write lock', () => {
  it('executes the protected operation', async () => {
    const result = await withGitNamespacePairWriteLock(
      { type: 'USER', id: 'dual-test-user-1' },
      { type: 'ORGANIZATION', id: 'dual-test-org-1' },
      async () => 'success',
    );

    expect(result).toBe('success');
  });

  it('handles identical namespace identities', async () => {
    const owner = { type: 'USER' as const, id: 'dual-test-user-2' };

    const result = await withGitNamespacePairWriteLock(owner, owner, async () => 42);

    expect(result).toBe(42);
  });

  it('waits for an existing namespace write lock', async () => {
    const owner = { type: 'USER' as const, id: 'dual-test-user-3' };
    const organization = {
      type: 'ORGANIZATION' as const,
      id: 'dual-test-org-3',
    };

    const events: string[] = [];
    let releaseExisting!: () => void;

    const existingLock = withGitNamespaceWriteLock(owner, async () => {
      events.push('existing-start');

      await new Promise<void>((resolve) => {
        releaseExisting = resolve;
      });

      events.push('existing-end');
    });

    await Promise.resolve();

    const transfer = withGitNamespacePairWriteLock(owner, organization, async () => {
      events.push('transfer');
    });

    releaseExisting();

    await Promise.all([existingLock, transfer]);

    expect(events).toEqual(['existing-start', 'existing-end', 'transfer']);
  });

  it('allows reversed lock requests to complete', async () => {
    const user = { type: 'USER' as const, id: 'dual-test-user-4' };
    const organization = {
      type: 'ORGANIZATION' as const,
      id: 'dual-test-org-4',
    };

    const events: string[] = [];

    await Promise.all([
      withGitNamespacePairWriteLock(user, organization, async () => {
        events.push('first');
      }),
      withGitNamespacePairWriteLock(organization, user, async () => {
        events.push('second');
      }),
    ]);

    expect(events).toHaveLength(2);
    expect(events).toContain('first');
    expect(events).toContain('second');
  });
});
