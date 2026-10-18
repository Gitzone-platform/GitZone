import { describe, expect, it } from 'vitest';

import {
  withGitUserReadLock,
  withGitUserWriteLock,
} from '../../../src/services/git/git-user-lock.service.js';

const deferred = () => {
  let resolve!: () => void;

  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('Git user read/write lock', () => {
  it('allows two readers for the same user concurrently', async () => {
    const gate = deferred();
    const events: string[] = [];

    const first = withGitUserReadLock('parallel-read-user', async () => {
      events.push('first-start');
      await gate.promise;
      events.push('first-end');
    });

    await flushMicrotasks();

    const second = withGitUserReadLock('parallel-read-user', async () => {
      events.push('second-start');
    });

    await flushMicrotasks();

    const bothStarted = events.includes('first-start') && events.includes('second-start');

    gate.resolve();

    await Promise.all([first, second]);

    expect(bothStarted).toBe(true);
  });

  it('waits for active readers before starting a writer', async () => {
    const gate = deferred();
    const events: string[] = [];

    const reader = withGitUserReadLock('writer-waits-user', async () => {
      events.push('reader-start');
      await gate.promise;
      events.push('reader-end');
    });

    await flushMicrotasks();

    const writer = withGitUserWriteLock('writer-waits-user', async () => {
      events.push('writer-start');
    });

    await flushMicrotasks();

    expect(events).toEqual(['reader-start']);

    gate.resolve();

    await Promise.all([reader, writer]);

    expect(events).toEqual(['reader-start', 'reader-end', 'writer-start']);
  });

  it('does not allow new readers to bypass a queued writer', async () => {
    const gate = deferred();
    const events: string[] = [];

    const firstReader = withGitUserReadLock('fairness-user', async () => {
      events.push('first-reader');
      await gate.promise;
    });

    await flushMicrotasks();

    const writer = withGitUserWriteLock('fairness-user', async () => {
      events.push('writer');
    });

    const secondReader = withGitUserReadLock('fairness-user', async () => {
      events.push('second-reader');
    });

    await flushMicrotasks();

    expect(events).toEqual(['first-reader']);

    gate.resolve();

    await Promise.all([firstReader, writer, secondReader]);

    expect(events).toEqual(['first-reader', 'writer', 'second-reader']);
  });

  it('does not block operations belonging to different users', async () => {
    const gate = deferred();
    const events: string[] = [];

    const first = withGitUserWriteLock('independent-user-a', async () => {
      events.push('user-a');
      await gate.promise;
    });

    await flushMicrotasks();

    const second = withGitUserWriteLock('independent-user-b', async () => {
      events.push('user-b');
    });

    await flushMicrotasks();

    const secondStarted = events.includes('user-b');

    gate.resolve();

    await Promise.all([first, second]);

    expect(secondStarted).toBe(true);
  });

  it('releases a writer lock when its operation throws', async () => {
    const events: string[] = [];

    await expect(
      withGitUserWriteLock('error-release-user', async () => {
        events.push('failed-operation');
        throw new Error('Expected failure');
      }),
    ).rejects.toThrow('Expected failure');

    await withGitUserReadLock('error-release-user', async () => {
      events.push('subsequent-reader');
    });

    expect(events).toEqual(['failed-operation', 'subsequent-reader']);
  });
});
