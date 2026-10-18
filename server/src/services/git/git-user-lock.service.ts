type LockMode = 'read' | 'write';

type LockRequest = {
  mode: LockMode;
  resolve: (release: () => void) => void;
};

type LockState = {
  readers: number;
  writer: boolean;
  queue: LockRequest[];
};

const locks = new Map<string, LockState>();

const getLockState = (userId: string): LockState => {
  const existing = locks.get(userId);

  if (existing) {
    return existing;
  }

  const state: LockState = {
    readers: 0,
    writer: false,
    queue: [],
  };

  locks.set(userId, state);

  return state;
};

const acquireLock = (userId: string, mode: LockMode): Promise<() => void> => {
  const state = getLockState(userId);

  return new Promise((resolve) => {
    const request: LockRequest = { mode, resolve };

    state.queue.push(request);

    const dispatch = (): void => {
      if (state.writer) {
        return;
      }

      const next = state.queue[0];

      if (!next) {
        if (state.readers === 0) {
          locks.delete(userId);
        }

        return;
      }

      if (next.mode === 'write') {
        if (state.readers > 0) {
          return;
        }
        state.queue.shift();
        state.writer = true;

        let released = false;

        next.resolve(() => {
          if (released) return;

          released = true;
          state.writer = false;
          dispatch();
        });

        return;
      }

      while (state.queue[0]?.mode === 'read') {
        const reader = state.queue.shift();

        if (!reader) break;

        state.readers += 1;

        let released = false;

        reader.resolve(() => {
          if (released) return;

          released = true;
          state.readers -= 1;

          if (state.readers === 0) {
            dispatch();
          }
        });
      }
    };

    dispatch();
  });
};

export const withGitUserReadLock = async <T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const release = await acquireLock(userId, 'read');

  try {
    return await operation();
  } finally {
    release();
  }
};

export const withGitUserWriteLock = async <T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const release = await acquireLock(userId, 'write');

  try {
    return await operation();
  } finally {
    release();
  }
};

/**
 * Stable Git namespace identity.
 *
 * The owner ID, not the mutable username or slug, determines the lock.
 */
export type GitNamespaceLockOwner =
  { type: 'USER'; id: string } | { type: 'ORGANIZATION'; id: string };

const getGitNamespaceLockKey = (owner: GitNamespaceLockOwner): string => {
  if (owner.id.length === 0) {
    throw new Error('Git namespace owner ID is required');
  }

  // Preserve the exact legacy lock key for user repositories.
  if (owner.type === 'USER') {
    return owner.id;
  }

  return `ORGANIZATION:${owner.id}`;
};

export const withGitNamespaceReadLock = async <T>(
  owner: GitNamespaceLockOwner,
  operation: () => Promise<T>,
): Promise<T> => {
  const release = await acquireLock(getGitNamespaceLockKey(owner), 'read');

  try {
    return await operation();
  } finally {
    release();
  }
};

export const withGitNamespaceWriteLock = async <T>(
  owner: GitNamespaceLockOwner,
  operation: () => Promise<T>,
): Promise<T> => {
  const release = await acquireLock(getGitNamespaceLockKey(owner), 'write');

  try {
    return await operation();
  } finally {
    release();
  }
};

/**
 * Acquire two namespace write locks in deterministic order.
 * Prevents deadlocks when transferring repositories between owners.
 */
export const withGitNamespacePairWriteLock = async <T>(
  firstOwner: GitNamespaceLockOwner,
  secondOwner: GitNamespaceLockOwner,
  operation: () => Promise<T>,
): Promise<T> => {
  const firstKey = getGitNamespaceLockKey(firstOwner);
  const secondKey = getGitNamespaceLockKey(secondOwner);

  if (firstKey === secondKey) {
    return withGitNamespaceWriteLock(firstOwner, operation);
  }

  const [first, second] =
    firstKey < secondKey ? [firstOwner, secondOwner] : [secondOwner, firstOwner];

  return withGitNamespaceWriteLock(first, () => withGitNamespaceWriteLock(second, operation));
};
