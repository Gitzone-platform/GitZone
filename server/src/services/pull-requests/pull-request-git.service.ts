import { AppError } from '../../errors/app.error.js';
import { GitReadError } from '../../errors/git-read.error.js';
import { GitWriteError } from '../../errors/git-write.error.js';

import { type GitCommitSummary, getGitCommit } from '../git/git-commit.service.js';

import { compareGitBranches, type GitCompareResult } from '../git/git-diff.service.js';

import { executeGitReadCommand } from '../git/git-read-command.service.js';
import { executeGitWriteCommand } from '../git/git-write-command.service.js';
import { getGitRepositoryRefs } from '../git/git-ref.service.js';

export type PullRequestMergeability = {
  mergeable: boolean;
  reason:
    | null
    | 'SOURCE_BRANCH_NOT_FOUND'
    | 'TARGET_BRANCH_NOT_FOUND'
    | 'NO_COMMITS_TO_MERGE'
    | 'NO_COMMON_ANCESTOR'
    | 'MERGE_CONFLICT';
  sourceSha: string | null;
  targetSha: string | null;
  mergeBase: string | null;
  aheadBy: number;
  behindBy: number;
};

export type PullRequestMergeResult = {
  mergeSha: string;
  sourceSha: string;
  previousTargetSha: string;
};

const getBranchOids = async (
  username: string,
  repositoryName: string,
  sourceBranch: string,
  targetBranch: string,
) => {
  const refs = await getGitRepositoryRefs(username, repositoryName);

  const source = refs.branches.find((branch) => branch.name === sourceBranch);

  const target = refs.branches.find((branch) => branch.name === targetBranch);

  return {
    source,
    target,
  };
};

export const getPullRequestCommits = async (
  username: string,
  repositoryName: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<GitCommitSummary[]> => {
  const { source, target } = await getBranchOids(
    username,
    repositoryName,
    sourceBranch,
    targetBranch,
  );

  if (!source) {
    throw new AppError('Source branch not found', 404, 'PULL_REQUEST_SOURCE_BRANCH_NOT_FOUND');
  }

  if (!target) {
    throw new AppError('Target branch not found', 404, 'PULL_REQUEST_TARGET_BRANCH_NOT_FOUND');
  }

  let result;

  try {
    result = await executeGitReadCommand({
      username,
      repositoryName,
      args: ['rev-list', '--reverse', `${target.oid}..${source.oid}`],
    });
  } catch (error) {
    if (error instanceof GitReadError && error.code === 'GIT_READ_COMMAND_FAILED') {
      throw new AppError(
        'Unable to calculate pull request commits',
        409,
        'PULL_REQUEST_COMMIT_CALCULATION_FAILED',
      );
    }

    throw error;
  }

  const shas = result.stdout
    .split(/\r?\n/)
    .map((sha) => sha.trim())
    .filter(Boolean);

  return Promise.all(
    shas.map(async (sha) => {
      const commit = await getGitCommit(username, repositoryName, sha);

      return {
        sha: commit.sha,
        parents: commit.parents,
        message: commit.message,
        author: commit.author,
        committer: commit.committer,
      };
    }),
  );
};

export const getPullRequestDiff = async (
  username: string,
  repositoryName: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<GitCompareResult> =>
  compareGitBranches(username, repositoryName, targetBranch, sourceBranch);

export const getPullRequestMergeability = async (
  username: string,
  repositoryName: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<PullRequestMergeability> => {
  const { source, target } = await getBranchOids(
    username,
    repositoryName,
    sourceBranch,
    targetBranch,
  );

  if (!source) {
    return {
      mergeable: false,
      reason: 'SOURCE_BRANCH_NOT_FOUND',
      sourceSha: null,
      targetSha: target?.oid ?? null,
      mergeBase: null,
      aheadBy: 0,
      behindBy: 0,
    };
  }

  if (!target) {
    return {
      mergeable: false,
      reason: 'TARGET_BRANCH_NOT_FOUND',
      sourceSha: source.oid,
      targetSha: null,
      mergeBase: null,
      aheadBy: 0,
      behindBy: 0,
    };
  }

  let comparison: GitCompareResult;

  try {
    comparison = await compareGitBranches(username, repositoryName, targetBranch, sourceBranch);
  } catch {
    return {
      mergeable: false,
      reason: 'NO_COMMON_ANCESTOR',
      sourceSha: source.oid,
      targetSha: target.oid,
      mergeBase: null,
      aheadBy: 0,
      behindBy: 0,
    };
  }

  if (comparison.aheadBy === 0) {
    return {
      mergeable: false,
      reason: 'NO_COMMITS_TO_MERGE',
      sourceSha: source.oid,
      targetSha: target.oid,
      mergeBase: comparison.mergeBase,
      aheadBy: comparison.aheadBy,
      behindBy: comparison.behindBy,
    };
  }

  if (!comparison.mergeBase) {
    return {
      mergeable: false,
      reason: 'NO_COMMON_ANCESTOR',
      sourceSha: source.oid,
      targetSha: target.oid,
      mergeBase: null,
      aheadBy: comparison.aheadBy,
      behindBy: comparison.behindBy,
    };
  }

  try {
    await executeGitReadCommand({
      username,
      repositoryName,
      args: ['merge-tree', '--write-tree', target.oid, source.oid],
    });
  } catch (error) {
    if (error instanceof GitReadError && error.code === 'GIT_READ_COMMAND_FAILED') {
      return {
        mergeable: false,
        reason: 'MERGE_CONFLICT',
        sourceSha: source.oid,
        targetSha: target.oid,
        mergeBase: comparison.mergeBase,
        aheadBy: comparison.aheadBy,
        behindBy: comparison.behindBy,
      };
    }

    throw error;
  }

  return {
    mergeable: true,
    reason: null,
    sourceSha: source.oid,
    targetSha: target.oid,
    mergeBase: comparison.mergeBase,
    aheadBy: comparison.aheadBy,
    behindBy: comparison.behindBy,
  };
};

export const mergePullRequestGit = async (
  username: string,
  repositoryName: string,
  sourceBranch: string,
  targetBranch: string,
  pullRequestNumber: number,
  title: string,
  mergerUsername: string,
  mergerEmail: string,
): Promise<PullRequestMergeResult> => {
  const mergeability = await getPullRequestMergeability(
    username,
    repositoryName,
    sourceBranch,
    targetBranch,
  );

  if (!mergeability.mergeable || !mergeability.sourceSha || !mergeability.targetSha) {
    throw new AppError(
      `Pull request is not mergeable: ${mergeability.reason ?? 'UNKNOWN'}`,
      409,
      'PULL_REQUEST_NOT_MERGEABLE',
    );
  }

  const sourceSha = mergeability.sourceSha;
  const targetSha = mergeability.targetSha;

  let mergeTree;

  try {
    mergeTree = await executeGitWriteCommand({
      username,
      repositoryName,
      args: ['merge-tree', '--write-tree', targetSha, sourceSha],
    });
  } catch (error) {
    if (error instanceof GitWriteError && error.code === 'GIT_WRITE_COMMAND_FAILED') {
      throw new AppError('Pull request has merge conflicts', 409, 'PULL_REQUEST_MERGE_CONFLICT');
    }

    throw error;
  }

  const treeSha = mergeTree.stdout.split(/\r?\n/)[0]?.trim();

  if (!treeSha) {
    throw new AppError('Git did not produce a merge tree', 500, 'PULL_REQUEST_MERGE_FAILED');
  }

  const safeUsername = mergerUsername.replace(/[\r\n<>]/g, '').trim() || 'GitZone';

  const safeEmail = mergerEmail.replace(/[\r\n<>]/g, '').trim() || 'noreply@gitzone.local';

  const message = `Merge pull request #${pullRequestNumber}\n\n${title}`;

  let commit;

  try {
    commit = await executeGitWriteCommand({
      username,
      repositoryName,
      args: [
        '-c',
        `user.name=${safeUsername}`,
        '-c',
        `user.email=${safeEmail}`,
        'commit-tree',
        treeSha,
        '-p',
        targetSha,
        '-p',
        sourceSha,
      ],
      stdin: `${message}\n`,
    });
  } catch (error) {
    if (error instanceof GitWriteError) {
      throw new AppError(
        'Failed to create pull request merge commit',
        500,
        'PULL_REQUEST_MERGE_FAILED',
      );
    }

    throw error;
  }

  const mergeSha = commit.stdout.trim();

  if (!mergeSha) {
    throw new AppError('Git did not return a merge commit SHA', 500, 'PULL_REQUEST_MERGE_FAILED');
  }

  try {
    await executeGitWriteCommand({
      username,
      repositoryName,
      args: ['update-ref', `refs/heads/${targetBranch}`, mergeSha, targetSha],
    });
  } catch (error) {
    if (error instanceof GitWriteError && error.code === 'GIT_WRITE_COMMAND_FAILED') {
      throw new AppError(
        'Target branch changed while pull request was being merged',
        409,
        'PULL_REQUEST_MERGE_CONFLICT',
      );
    }

    throw error;
  }

  return {
    mergeSha,
    sourceSha,
    previousTargetSha: targetSha,
  };
};

export const executePullRequestMergeRollback = async (
  username: string,
  repositoryName: string,
  targetBranch: string,
  previousTargetSha: string,
  mergeSha: string,
): Promise<void> => {
  try {
    await executeGitWriteCommand({
      username,
      repositoryName,
      args: ['update-ref', `refs/heads/${targetBranch}`, previousTargetSha, mergeSha],
    });
  } catch (error) {
    if (error instanceof GitWriteError && error.code === 'GIT_WRITE_COMMAND_FAILED') {
      throw new AppError(
        'Git merge rollback conflict',
        409,
        'PULL_REQUEST_MERGE_ROLLBACK_CONFLICT',
      );
    }

    throw error;
  }
};
