import { AppError } from '../../errors/app.error.js';
import { GitReadError } from '../../errors/git-read.error.js';
import { isSafeGitRefName } from '../../utils/git/ref-name.js';
import { executeGitReadCommand } from './git-read-command.service.js';
import { getGitRepositoryRefs } from './git-ref.service.js';

const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

const DEFAULT_DIFF_LIMIT_BYTES = 1024 * 1024;

export type GitUnifiedDiff = {
  diff: string;
  size: number;
  truncated: boolean;
  binary: boolean;
};

export type GitCompareResult = {
  base: string;
  head: string;
  mergeBase: string | null;
  aheadBy: number;
  behindBy: number;
  diff: GitUnifiedDiff;
};

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

const containsBinaryDiff = (diff: string): boolean =>
  /^Binary files .* differ$/m.test(diff) || /^GIT binary patch$/m.test(diff);

const limitDiff = (diff: string, maxBytes: number): GitUnifiedDiff => {
  const size = byteLength(diff);

  if (size <= maxBytes) {
    return {
      diff,
      size,
      truncated: false,
      binary: containsBinaryDiff(diff),
    };
  }

  const buffer = Buffer.from(diff, 'utf8');

  const limited = buffer.subarray(0, maxBytes).toString('utf8');

  return {
    diff: limited,
    size,
    truncated: true,
    binary: containsBinaryDiff(diff),
  };
};

const validateLimit = (maxBytes: number): void => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 5 * 1024 * 1024) {
    throw new AppError('Invalid Git diff limit', 400, 'INVALID_GIT_DIFF_LIMIT');
  }
};

const assertCommitSha = (sha: string): void => {
  if (!SHA_PATTERN.test(sha)) {
    throw new AppError('Invalid commit SHA', 400, 'INVALID_GIT_COMMIT_SHA');
  }
};

const resolveBranch = async (
  username: string,
  repositoryName: string,
  branchName: string,
): Promise<string> => {
  if (!isSafeGitRefName(branchName)) {
    throw new AppError('Invalid Git branch name', 400, 'INVALID_GIT_REF');
  }

  const refs = await getGitRepositoryRefs(username, repositoryName);

  const branch = refs.branches.find((candidate) => candidate.name === branchName);

  if (!branch) {
    throw new AppError('Git branch not found', 404, 'GIT_REF_NOT_FOUND');
  }

  return branch.fullName;
};

const mapDiffFailure = (error: unknown): never => {
  if (error instanceof AppError) {
    throw error;
  }

  if (
    error instanceof GitReadError &&
    error.code === 'GIT_READ_COMMAND_FAILED' &&
    error.exitCode === 128
  ) {
    throw new AppError('Git revision not found', 404, 'GIT_REVISION_NOT_FOUND');
  }

  if (error instanceof GitReadError && error.code === 'GIT_READ_OUTPUT_LIMIT_EXCEEDED') {
    throw new AppError(
      'Git diff exceeded the server output limit',
      413,
      'GIT_DIFF_OUTPUT_LIMIT_EXCEEDED',
    );
  }

  throw new AppError('Failed to read Git diff', 500, 'GIT_DIFF_READ_FAILED');
};

export const getGitCommitDiff = async (
  username: string,
  repositoryName: string,
  sha: string,
  maxBytes = DEFAULT_DIFF_LIMIT_BYTES,
): Promise<GitUnifiedDiff> => {
  assertCommitSha(sha);
  validateLimit(maxBytes);

  try {
    const result = await executeGitReadCommand({
      username,
      repositoryName,
      args: [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--patch',
        '--binary',
        '--no-ext-diff',
        '--no-color',
        '--end-of-options',
        sha,
      ],
    });

    return limitDiff(result.stdout, maxBytes);
  } catch (error) {
    return mapDiffFailure(error);
  }
};

const getCommitDistance = async (
  username: string,
  repositoryName: string,
  base: string,
  head: string,
): Promise<{
  aheadBy: number;
  behindBy: number;
}> => {
  const result = await executeGitReadCommand({
    username,
    repositoryName,
    args: ['rev-list', '--left-right', '--count', `${base}...${head}`],
  });

  const parts = result.stdout.trim().split(/\s+/);

  if (parts.length !== 2) {
    throw new AppError(
      'Git repository returned invalid comparison data',
      500,
      'GIT_COMPARE_DATA_INVALID',
    );
  }

  const behindBy = Number(parts[0]);
  const aheadBy = Number(parts[1]);

  if (
    !Number.isSafeInteger(aheadBy) ||
    aheadBy < 0 ||
    !Number.isSafeInteger(behindBy) ||
    behindBy < 0
  ) {
    throw new AppError(
      'Git repository returned invalid comparison data',
      500,
      'GIT_COMPARE_DATA_INVALID',
    );
  }

  return {
    aheadBy,
    behindBy,
  };
};

const getMergeBase = async (
  username: string,
  repositoryName: string,
  base: string,
  head: string,
): Promise<string | null> => {
  try {
    const result = await executeGitReadCommand({
      username,
      repositoryName,
      args: ['merge-base', base, head],
    });

    const value = result.stdout.trim();

    return SHA_PATTERN.test(value) ? value : null;
  } catch (error) {
    if (
      error instanceof GitReadError &&
      error.code === 'GIT_READ_COMMAND_FAILED' &&
      error.exitCode === 1
    ) {
      return null;
    }

    throw error;
  }
};

const compareRevisions = async (
  username: string,
  repositoryName: string,
  base: string,
  head: string,
  maxBytes: number,
): Promise<GitCompareResult> => {
  validateLimit(maxBytes);

  const distance = await getCommitDistance(username, repositoryName, base, head);

  const mergeBase = await getMergeBase(username, repositoryName, base, head);

  const result = await executeGitReadCommand({
    username,
    repositoryName,
    args: [
      'diff',
      '--patch',
      '--binary',
      '--no-ext-diff',
      '--no-color',
      '--find-renames',
      '--find-copies',
      `${base}...${head}`,
    ],
  });

  return {
    base,
    head,
    mergeBase,
    aheadBy: distance.aheadBy,
    behindBy: distance.behindBy,
    diff: limitDiff(result.stdout, maxBytes),
  };
};

export const compareGitCommits = async (
  username: string,
  repositoryName: string,
  baseSha: string,
  headSha: string,
  maxBytes = DEFAULT_DIFF_LIMIT_BYTES,
): Promise<GitCompareResult> => {
  assertCommitSha(baseSha);
  assertCommitSha(headSha);

  try {
    return await compareRevisions(username, repositoryName, baseSha, headSha, maxBytes);
  } catch (error) {
    return mapDiffFailure(error);
  }
};

export const compareGitBranches = async (
  username: string,
  repositoryName: string,
  baseBranch: string,
  headBranch: string,
  maxBytes = DEFAULT_DIFF_LIMIT_BYTES,
): Promise<GitCompareResult> => {
  try {
    const base = await resolveBranch(username, repositoryName, baseBranch);

    const head = await resolveBranch(username, repositoryName, headBranch);

    return await compareRevisions(username, repositoryName, base, head, maxBytes);
  } catch (error) {
    return mapDiffFailure(error);
  }
};
