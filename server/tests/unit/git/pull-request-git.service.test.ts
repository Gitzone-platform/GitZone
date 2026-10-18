import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitReadError } from '../../../src/errors/git-read.error.js';
import { GitWriteError } from '../../../src/errors/git-write.error.js';

import { getGitCommit } from '../../../src/services/git/git-commit.service.js';
import { compareGitBranches } from '../../../src/services/git/git-diff.service.js';
import { executeGitReadCommand } from '../../../src/services/git/git-read-command.service.js';
import { getGitRepositoryRefs } from '../../../src/services/git/git-ref.service.js';
import { executeGitWriteCommand } from '../../../src/services/git/git-write-command.service.js';

vi.mock('../../../src/services/git/git-commit.service.js', () => ({
  getGitCommit: vi.fn(),
}));

vi.mock('../../../src/services/git/git-diff.service.js', () => ({
  compareGitBranches: vi.fn(),
}));

vi.mock('../../../src/services/git/git-read-command.service.js', () => ({
  executeGitReadCommand: vi.fn(),
}));

vi.mock('../../../src/services/git/git-ref.service.js', () => ({
  getGitRepositoryRefs: vi.fn(),
}));

vi.mock('../../../src/services/git/git-write-command.service.js', () => ({
  executeGitWriteCommand: vi.fn(),
}));

const mockedCommit = vi.mocked(getGitCommit);
const mockedCompare = vi.mocked(compareGitBranches);
const mockedRead = vi.mocked(executeGitReadCommand);
const mockedRefs = vi.mocked(getGitRepositoryRefs);
const mockedWrite = vi.mocked(executeGitWriteCommand);

const TARGET_SHA = '1111111111111111111111111111111111111111';
const SOURCE_SHA = '2222222222222222222222222222222222222222';
const COMMIT_SHA = '3333333333333333333333333333333333333333';
const TREE_SHA = '4444444444444444444444444444444444444444';
const MERGE_SHA = '5555555555555555555555555555555555555555';

const refs = {
  objectFormat: 'sha1' as const,
  symbolicHead: 'refs/heads/main',
  defaultBranch: 'main',
  head: {
    name: 'main',
    fullName: 'refs/heads/main',
    oid: TARGET_SHA,
    objectType: 'commit' as const,
  },
  branches: [
    {
      name: 'main',
      fullName: 'refs/heads/main',
      oid: TARGET_SHA,
      objectType: 'commit' as const,
    },
    {
      name: 'feature',
      fullName: 'refs/heads/feature',
      oid: SOURCE_SHA,
      objectType: 'commit' as const,
    },
  ],
  tags: [],
};

const comparison = {
  base: TARGET_SHA,
  head: SOURCE_SHA,
  mergeBase: TARGET_SHA,
  aheadBy: 1,
  behindBy: 0,
  diff: {
    diff: 'diff --git a/file.ts b/file.ts',
    size: 64,
    truncated: false,
    binary: false,
  },
};

const commitDetail = {
  sha: COMMIT_SHA,
  parents: [TARGET_SHA],
  author: {
    name: 'Author',
    email: 'author@gitzone.local',
    date: '2026-10-07T10:00:00+05:00',
  },
  committer: {
    name: 'Committer',
    email: 'committer@gitzone.local',
    date: '2026-10-07T10:01:00+05:00',
  },
  message: 'feat: PR commit',
  stats: {
    additions: 1,
    deletions: 0,
    filesChanged: 1,
  },
  files: [],
};

const {
  executePullRequestMergeRollback,
  getPullRequestCommits,
  getPullRequestDiff,
  getPullRequestMergeability,
  mergePullRequestGit,
} = await import('../../../src/services/pull-requests/pull-request-git.service.js');

describe('pull request Git service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedRefs.mockResolvedValue(refs);
    mockedCompare.mockResolvedValue(comparison);
    mockedRead.mockResolvedValue({
      stdout: '',
      stderr: '',
    });
    mockedWrite.mockResolvedValue({
      stdout: '',
      stderr: '',
    });
    mockedCommit.mockResolvedValue(commitDetail);
  });

  it('calculates commits present in source but not target', async () => {
    mockedRead.mockResolvedValueOnce({
      stdout: `${COMMIT_SHA}\n`,
      stderr: '',
    });

    const commits = await getPullRequestCommits('asil', 'demo', 'feature', 'main');

    expect(mockedRead).toHaveBeenCalledWith({
      username: 'asil',
      repositoryName: 'demo',
      args: ['rev-list', '--reverse', `${TARGET_SHA}..${SOURCE_SHA}`],
    });

    expect(commits).toEqual([
      {
        sha: COMMIT_SHA,
        parents: [TARGET_SHA],
        message: 'feat: PR commit',
        author: commitDetail.author,
        committer: commitDetail.committer,
      },
    ]);
  });

  it('calculates pull request diff using target as base', async () => {
    const result = await getPullRequestDiff('asil', 'demo', 'feature', 'main');

    expect(mockedCompare).toHaveBeenCalledWith('asil', 'demo', 'main', 'feature');

    expect(result).toEqual(comparison);
  });

  it('reports a mergeable pull request', async () => {
    mockedRead.mockResolvedValueOnce({
      stdout: `${TREE_SHA}\n`,
      stderr: '',
    });

    const result = await getPullRequestMergeability('asil', 'demo', 'feature', 'main');

    expect(result).toEqual({
      mergeable: true,
      reason: null,
      sourceSha: SOURCE_SHA,
      targetSha: TARGET_SHA,
      mergeBase: TARGET_SHA,
      aheadBy: 1,
      behindBy: 0,
    });
  });

  it('reports no commits when source is not ahead', async () => {
    mockedCompare.mockResolvedValueOnce({
      ...comparison,
      aheadBy: 0,
    });

    const result = await getPullRequestMergeability('asil', 'demo', 'feature', 'main');

    expect(result.mergeable).toBe(false);
    expect(result.reason).toBe('NO_COMMITS_TO_MERGE');
  });

  it('reports merge conflicts', async () => {
    mockedRead.mockRejectedValueOnce(new GitReadError('merge conflict', 'GIT_READ_COMMAND_FAILED'));

    const result = await getPullRequestMergeability('asil', 'demo', 'feature', 'main');

    expect(result.mergeable).toBe(false);
    expect(result.reason).toBe('MERGE_CONFLICT');
  });

  it('creates a merge commit and atomically updates target', async () => {
    mockedRead.mockResolvedValueOnce({
      stdout: `${TREE_SHA}\n`,
      stderr: '',
    });

    mockedWrite
      .mockResolvedValueOnce({
        stdout: `${TREE_SHA}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: `${MERGE_SHA}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      });

    const result = await mergePullRequestGit(
      'asil',
      'demo',
      'feature',
      'main',
      7,
      'Feature PR',
      'asil',
      'asil@gitzone.local',
    );

    expect(result).toEqual({
      mergeSha: MERGE_SHA,
      sourceSha: SOURCE_SHA,
      previousTargetSha: TARGET_SHA,
    });

    expect(mockedWrite).toHaveBeenLastCalledWith({
      username: 'asil',
      repositoryName: 'demo',
      args: ['update-ref', 'refs/heads/main', MERGE_SHA, TARGET_SHA],
    });
  });

  it('rejects merge when atomic target update conflicts', async () => {
    mockedRead.mockResolvedValueOnce({
      stdout: `${TREE_SHA}\n`,
      stderr: '',
    });

    mockedWrite
      .mockResolvedValueOnce({
        stdout: `${TREE_SHA}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: `${MERGE_SHA}\n`,
        stderr: '',
      })
      .mockRejectedValueOnce(new GitWriteError('conflict', 'GIT_WRITE_COMMAND_FAILED'));

    await expect(
      mergePullRequestGit(
        'asil',
        'demo',
        'feature',
        'main',
        7,
        'Feature PR',
        'asil',
        'asil@gitzone.local',
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PULL_REQUEST_MERGE_CONFLICT',
    });
  });

  it('rolls back target with compare-and-swap semantics', async () => {
    await executePullRequestMergeRollback('asil', 'demo', 'main', TARGET_SHA, MERGE_SHA);

    expect(mockedWrite).toHaveBeenCalledWith({
      username: 'asil',
      repositoryName: 'demo',
      args: ['update-ref', 'refs/heads/main', TARGET_SHA, MERGE_SHA],
    });
  });
});
