import type { PullRequestState } from '../../generated/prisma/enums.js';
import type { Prisma } from '../../generated/prisma/client.js';

import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import { isSafeGitRefName } from '../../utils/git/ref-name.js';
import { getGitRepositoryRefs } from '../git/git-ref.service.js';
import { authorizeRepositoryAccess } from '../repositories/repository-authorization.service.js';
import {
  getPullRequestCommits as calculatePullRequestCommits,
  getPullRequestDiff as calculatePullRequestDiff,
  getPullRequestMergeability as calculatePullRequestMergeability,
  mergePullRequestGit,
  executePullRequestMergeRollback,
} from './pull-request-git.service.js';

import type {
  CreatePullRequestInput,
  UpdatePullRequestInput,
} from '../../validations/pull-requests/pull-request.validation.js';

type PullRequestRepository = {
  id: string;
  name: string;
  ownerId: string;
  owner: {
    username: string;
  };
};

const pullRequestInclude = {
  author: {
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
    },
  },
  mergedBy: {
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
    },
  },
  labels: {
    include: {
      label: true,
    },
  },
  milestone: {
    select: {
      id: true,
      repositoryId: true,
      title: true,
      description: true,
      state: true,
      dueDate: true,
      closedAt: true,
    },
  },
} satisfies Prisma.PullRequestInclude;

const findRepository = async (
  username: string,
  repositoryName: string,
): Promise<PullRequestRepository> => {
  const repository = await prisma.repository.findFirst({
    where: {
      name: repositoryName,
      organizationId: null,
      owner: {
        username,
      },
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      owner: {
        select: {
          username: true,
        },
      },
    },
  });

  if (!repository || !repository.ownerId || !repository.owner) {
    throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
  }

  return {
    id: repository.id,
    name: repository.name,
    ownerId: repository.ownerId,
    owner: repository.owner,
  };
};

const validatePullRequestBranches = async (
  username: string,
  repositoryName: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<void> => {
  if (sourceBranch === targetBranch) {
    throw new AppError(
      'Source and target branches must be different',
      400,
      'PULL_REQUEST_SAME_BRANCH',
    );
  }

  if (!isSafeGitRefName(sourceBranch) || !isSafeGitRefName(targetBranch)) {
    throw new AppError('Invalid pull request branch', 400, 'INVALID_PULL_REQUEST_BRANCH');
  }

  const refs = await getGitRepositoryRefs(username, repositoryName);

  const sourceExists = refs.branches.some((branch) => branch.name === sourceBranch);

  if (!sourceExists) {
    throw new AppError('Source branch not found', 404, 'PULL_REQUEST_SOURCE_BRANCH_NOT_FOUND');
  }

  const targetExists = refs.branches.some((branch) => branch.name === targetBranch);

  if (!targetExists) {
    throw new AppError('Target branch not found', 404, 'PULL_REQUEST_TARGET_BRANCH_NOT_FOUND');
  }
};

const getPullRequestRecord = async (repositoryId: string, number: number) => {
  const pullRequest = await prisma.pullRequest.findUnique({
    where: {
      repositoryId_number: {
        repositoryId,
        number,
      },
    },
    include: pullRequestInclude,
  });

  if (!pullRequest) {
    throw new AppError('Pull request not found', 404, 'PULL_REQUEST_NOT_FOUND');
  }

  return pullRequest;
};

export const createPullRequest = async (
  userId: string,
  username: string,
  repositoryName: string,
  input: CreatePullRequestInput,
) => {
  const repository = await findRepository(username, repositoryName);

  await authorizeRepositoryAccess(repository.id, 'WRITE', userId);

  await validatePullRequestBranches(
    username,
    repositoryName,
    input.sourceBranch,
    input.targetBranch,
  );

  return prisma.$transaction(async (tx) => {
    /*
     * Transaction-scoped PostgreSQL advisory lock.
     *
     * hashtext(repositoryId) gives each repository its own lock,
     * serializing PR-number allocation and duplicate-open checks
     * without blocking PR creation in other repositories.
     */
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${repository.id}))
    `;

    const duplicate = await tx.pullRequest.findFirst({
      where: {
        repositoryId: repository.id,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        state: 'OPEN',
      },
      select: {
        number: true,
      },
    });

    if (duplicate) {
      throw new AppError(
        `An open pull request already exists for these branches (#${duplicate.number})`,
        409,
        'PULL_REQUEST_ALREADY_EXISTS',
      );
    }

    const latest = await tx.pullRequest.aggregate({
      where: {
        repositoryId: repository.id,
      },
      _max: {
        number: true,
      },
    });

    const number = (latest._max.number ?? 0) + 1;

    return tx.pullRequest.create({
      data: {
        repositoryId: repository.id,
        number,
        authorId: userId,
        title: input.title,
        description: input.description ?? null,
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
      },
      include: pullRequestInclude,
    });
  });
};

export const listPullRequests = async (
  username: string,
  repositoryName: string,
  userId?: string,
  state?: PullRequestState,
) => {
  const repository = await findRepository(username, repositoryName);

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  return prisma.pullRequest.findMany({
    where: {
      repositoryId: repository.id,
      ...(state !== undefined && {
        state,
      }),
    },
    include: pullRequestInclude,
    orderBy: {
      number: 'desc',
    },
  });
};

export const getPullRequest = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
) => {
  const repository = await findRepository(username, repositoryName);

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  return getPullRequestRecord(repository.id, number);
};

export const updatePullRequest = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  input: UpdatePullRequestInput,
) => {
  const repository = await findRepository(username, repositoryName);

  await authorizeRepositoryAccess(repository.id, 'WRITE', userId);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${repository.id}))
    `;

    const pullRequest = await tx.pullRequest.findUnique({
      where: {
        repositoryId_number: {
          repositoryId: repository.id,
          number,
        },
      },
    });

    if (!pullRequest) {
      throw new AppError('Pull request not found', 404, 'PULL_REQUEST_NOT_FOUND');
    }

    if (pullRequest.state === 'MERGED') {
      throw new AppError(
        'Merged pull request cannot be modified',
        409,
        'PULL_REQUEST_ALREADY_MERGED',
      );
    }

    if (input.state === 'OPEN' && pullRequest.state === 'CLOSED') {
      await validatePullRequestBranches(
        username,
        repositoryName,
        pullRequest.sourceBranch,
        pullRequest.targetBranch,
      );

      const duplicate = await tx.pullRequest.findFirst({
        where: {
          repositoryId: repository.id,
          sourceBranch: pullRequest.sourceBranch,
          targetBranch: pullRequest.targetBranch,
          state: 'OPEN',
          NOT: {
            id: pullRequest.id,
          },
        },
        select: {
          number: true,
        },
      });

      if (duplicate) {
        throw new AppError(
          `Another open pull request already exists for these branches (#${duplicate.number})`,
          409,
          'PULL_REQUEST_ALREADY_EXISTS',
        );
      }
    }

    return tx.pullRequest.update({
      where: {
        id: pullRequest.id,
      },
      data: {
        ...(input.title !== undefined && {
          title: input.title,
        }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.state !== undefined && {
          state: input.state,
        }),
      },
      include: pullRequestInclude,
    });
  });
};

export const getPullRequestCommits = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
) => {
  const repository = await findRepository(username, repositoryName);

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  const pullRequest = await getPullRequestRecord(repository.id, number);

  return calculatePullRequestCommits(
    username,
    repositoryName,
    pullRequest.sourceBranch,
    pullRequest.targetBranch,
  );
};

export const getPullRequestDiff = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
) => {
  const repository = await findRepository(username, repositoryName);

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  const pullRequest = await getPullRequestRecord(repository.id, number);

  return calculatePullRequestDiff(
    username,
    repositoryName,
    pullRequest.sourceBranch,
    pullRequest.targetBranch,
  );
};

export const getPullRequestMergeability = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
) => {
  const repository = await findRepository(username, repositoryName);

  await authorizeRepositoryAccess(repository.id, 'READ', userId);

  const pullRequest = await getPullRequestRecord(repository.id, number);

  if (pullRequest.state !== 'OPEN') {
    return {
      mergeable: false,
      reason:
        pullRequest.state === 'MERGED' ? 'PULL_REQUEST_ALREADY_MERGED' : 'PULL_REQUEST_CLOSED',
      sourceSha: null,
      targetSha: null,
      mergeBase: null,
      aheadBy: 0,
      behindBy: 0,
    };
  }

  return calculatePullRequestMergeability(
    username,
    repositoryName,
    pullRequest.sourceBranch,
    pullRequest.targetBranch,
  );
};

export const mergePullRequest = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
) => {
  const repository = await findRepository(username, repositoryName);

  await authorizeRepositoryAccess(repository.id, 'WRITE', userId);

  const pullRequest = await getPullRequestRecord(repository.id, number);

  if (pullRequest.state === 'MERGED') {
    throw new AppError('Pull request is already merged', 409, 'PULL_REQUEST_ALREADY_MERGED');
  }

  if (pullRequest.state !== 'OPEN') {
    throw new AppError('Closed pull request cannot be merged', 409, 'PULL_REQUEST_CLOSED');
  }

  const merger = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      username: true,
      email: true,
    },
  });

  if (!merger) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  /*
   * Serialize merge attempts for this repository.
   *
   * The Git ref update itself also uses compare-and-swap,
   * protecting against Git changes made outside this
   * database transaction.
   */
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${repository.id}))
    `;

    const currentPullRequest = await tx.pullRequest.findUnique({
      where: {
        repositoryId_number: {
          repositoryId: repository.id,
          number,
        },
      },
    });

    if (!currentPullRequest) {
      throw new AppError('Pull request not found', 404, 'PULL_REQUEST_NOT_FOUND');
    }

    if (currentPullRequest.state === 'MERGED') {
      throw new AppError('Pull request is already merged', 409, 'PULL_REQUEST_ALREADY_MERGED');
    }

    if (currentPullRequest.state !== 'OPEN') {
      throw new AppError('Closed pull request cannot be merged', 409, 'PULL_REQUEST_CLOSED');
    }

    const gitResult = await mergePullRequestGit(
      username,
      repositoryName,
      currentPullRequest.sourceBranch,
      currentPullRequest.targetBranch,
      currentPullRequest.number,
      currentPullRequest.title,
      merger.username,
      merger.email,
    );

    try {
      return await tx.pullRequest.update({
        where: {
          id: currentPullRequest.id,
        },
        data: {
          state: 'MERGED',
          mergedAt: new Date(),
          mergedById: userId,
          mergeSha: gitResult.mergeSha,
        },
        include: pullRequestInclude,
      });
    } catch (error) {
      /*
       * DB update failed after Git ref moved.
       * Attempt a CAS rollback only if the target still
       * points to the merge commit we created.
       */
      try {
        await executePullRequestMergeRollback(
          username,
          repositoryName,
          currentPullRequest.targetBranch,
          gitResult.previousTargetSha,
          gitResult.mergeSha,
        );
      } catch {
        throw new AppError(
          'Pull request database update failed and Git rollback could not be completed',
          500,
          'PULL_REQUEST_MERGE_INCONSISTENT',
        );
      }

      throw error;
    }
  });
};
