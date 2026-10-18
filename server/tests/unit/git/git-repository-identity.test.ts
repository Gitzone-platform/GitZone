import { describe, expect, it } from 'vitest';

import { assertGitRepositoryIdentity } from '../../../src/services/git/git-repository-identity.service.js';
import type { GitRepositoryLookupResult } from '../../../src/services/git/git-repository-lookup.service.js';

const userRepository: GitRepositoryLookupResult = {
  id: 'repo-1',
  name: 'backend',
  isPrivate: true,
  defaultBranch: 'main',
  owner: {
    type: 'USER',
    id: 'user-1',
    name: 'asil',
  },
};

const organizationRepository: GitRepositoryLookupResult = {
  ...userRepository,
  owner: {
    type: 'ORGANIZATION',
    id: 'org-1',
    name: 'gitzone-team',
  },
};

const expectNotFound = (
  initial: GitRepositoryLookupResult,
  current: GitRepositoryLookupResult,
): void => {
  expect(() => assertGitRepositoryIdentity(initial, current)).toThrowError(
    expect.objectContaining({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    }),
  );
};

describe('assertGitRepositoryIdentity', () => {
  it('accepts an unchanged user repository', () => {
    expect(() => assertGitRepositoryIdentity(userRepository, { ...userRepository })).not.toThrow();
  });

  it('accepts an unchanged organization repository', () => {
    expect(() =>
      assertGitRepositoryIdentity(organizationRepository, {
        ...organizationRepository,
      }),
    ).not.toThrow();
  });

  it('rejects a changed repository ID', () => {
    expectNotFound(userRepository, {
      ...userRepository,
      id: 'repo-2',
    });
  });

  it('rejects a changed repository name', () => {
    expectNotFound(userRepository, {
      ...userRepository,
      name: 'renamed-backend',
    });
  });

  it('rejects a changed owner ID', () => {
    expectNotFound(organizationRepository, {
      ...organizationRepository,
      owner: {
        ...organizationRepository.owner,
        id: 'org-2',
      },
    });
  });

  it('rejects a changed organization slug', () => {
    expectNotFound(organizationRepository, {
      ...organizationRepository,
      owner: {
        ...organizationRepository.owner,
        name: 'renamed-team',
      },
    });
  });

  it('rejects a changed user username', () => {
    expectNotFound(userRepository, {
      ...userRepository,
      owner: {
        ...userRepository.owner,
        name: 'renamed-user',
      },
    });
  });

  it('rejects switching from user to organization ownership', () => {
    expectNotFound(userRepository, {
      ...userRepository,
      owner: {
        type: 'ORGANIZATION',
        id: 'user-1',
        name: 'asil',
      },
    });
  });

  it('rejects switching from organization to user ownership', () => {
    expectNotFound(organizationRepository, {
      ...organizationRepository,
      owner: {
        type: 'USER',
        id: 'org-1',
        name: 'gitzone-team',
      },
    });
  });

  it('allows privacy changes while preserving repository identity', () => {
    expect(() =>
      assertGitRepositoryIdentity(userRepository, {
        ...userRepository,
        isPrivate: false,
      }),
    ).not.toThrow();
  });
});
