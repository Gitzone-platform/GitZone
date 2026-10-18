import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../src/errors/app.error.js';
import { GitReadError } from '../../../src/errors/git-read.error.js';
import { getGitCommit, listGitCommits } from '../../../src/services/git/git-commit.service.js';
import { executeGitReadCommand } from '../../../src/services/git/git-read-command.service.js';
import { getGitRepositoryRefs } from '../../../src/services/git/git-ref.service.js';

vi.mock('../../../src/services/git/git-read-command.service.js', () => ({
  executeGitReadCommand: vi.fn(),
}));

vi.mock('../../../src/services/git/git-ref.service.js', () => ({
  getGitRepositoryRefs: vi.fn(),
}));

const executeGitReadCommandMock = vi.mocked(executeGitReadCommand);

const getGitRepositoryRefsMock = vi.mocked(getGitRepositoryRefs);

const ROOT_SHA = '1'.repeat(40);
const SECOND_SHA = '2'.repeat(40);
const THIRD_SHA = '3'.repeat(40);
const FOURTH_SHA = '4'.repeat(40);

const FIELD_SEPARATOR = '\x1f';
const RECORD_SEPARATOR = '\x1e';

const commitRecord = (sha: string, message: string, parents = ''): string =>
  [
    sha,
    'Phase 6 Author',
    'author@example.com',
    '2026-10-07T10:00:00+05:00',
    'Phase 6 Committer',
    'committer@example.com',
    '2026-10-07T10:01:00+05:00',
    message,
    parents,
  ].join(FIELD_SEPARATOR);

const refs = {
  objectFormat: 'sha1' as const,
  symbolicHead: 'refs/heads/main',
  defaultBranch: 'main',
  head: {
    name: 'main',
    fullName: 'refs/heads/main',
    oid: FOURTH_SHA,
    objectType: 'commit' as const,
  },
  branches: [
    {
      name: 'main',
      fullName: 'refs/heads/main',
      oid: FOURTH_SHA,
      objectType: 'commit' as const,
    },
    {
      name: 'feature/compare',
      fullName: 'refs/heads/feature/compare',
      oid: THIRD_SHA,
      objectType: 'commit' as const,
    },
  ],
  tags: [],
};

describe('git commit service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGitRepositoryRefsMock.mockResolvedValue(refs);
  });

  it('lists commit history with author, committer and parents', async () => {
    executeGitReadCommandMock.mockResolvedValueOnce({
      stdout:
        RECORD_SEPARATOR +
        commitRecord(FOURTH_SHA, 'fourth commit', THIRD_SHA) +
        RECORD_SEPARATOR +
        commitRecord(THIRD_SHA, 'third commit', SECOND_SHA),
      stderr: '',
    });

    const commits = await listGitCommits('alice', 'demo', undefined, undefined, 1, 2);

    expect(commits).toHaveLength(2);

    expect(commits[0]).toEqual({
      sha: FOURTH_SHA,
      author: {
        name: 'Phase 6 Author',
        email: 'author@example.com',
        date: '2026-10-07T10:00:00+05:00',
      },
      committer: {
        name: 'Phase 6 Committer',
        email: 'committer@example.com',
        date: '2026-10-07T10:01:00+05:00',
      },
      message: 'fourth commit',
      parents: [THIRD_SHA],
    });
  });

  it('uses max-count and skip for pagination', async () => {
    executeGitReadCommandMock.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    });

    await listGitCommits('alice', 'demo', undefined, undefined, 3, 25);

    expect(executeGitReadCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
        repositoryName: 'demo',
        args: expect.arrayContaining([
          'log',
          '--max-count=25',
          '--skip=50',
          '--end-of-options',
          'refs/heads/main',
        ]),
      }),
    );
  });

  it('supports branch-specific history', async () => {
    executeGitReadCommandMock.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    });

    await listGitCommits('alice', 'demo', 'feature/compare', undefined, 1, 30);

    expect(executeGitReadCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['refs/heads/feature/compare']),
      }),
    );
  });

  it('supports path-filtered history', async () => {
    executeGitReadCommandMock.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    });

    await listGitCommits('alice', 'demo', undefined, 'src/index.ts', 1, 30);

    const call = executeGitReadCommandMock.mock.calls[0]?.[0];

    expect(call?.args.slice(-2)).toEqual(['--', 'src/index.ts']);
  });

  it('rejects an unknown requested ref', async () => {
    await expect(
      listGitCommits('alice', 'demo', 'missing', undefined, 1, 30),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'GIT_REF_NOT_FOUND',
    });
  });

  it('returns complete commit details and statistics', async () => {
    executeGitReadCommandMock
      .mockResolvedValueOnce({
        stdout: commitRecord(THIRD_SHA, 'refactor files', SECOND_SHA),
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: 'R069\0README.md\0DOCUMENTATION.md\0' + 'M\0math.ts\0',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: '1\t0\t\0README.md\0DOCUMENTATION.md\0' + '4\t2\tmath.ts\0',
        stderr: '',
      });

    const commit = await getGitCommit('alice', 'demo', THIRD_SHA);

    expect(commit.parents).toEqual([SECOND_SHA]);

    expect(commit.stats).toEqual({
      additions: 5,
      deletions: 2,
      filesChanged: 2,
    });

    expect(commit.files).toEqual([
      {
        path: 'DOCUMENTATION.md',
        previousPath: 'README.md',
        status: 'renamed',
        additions: 1,
        deletions: 0,
        binary: false,
      },
      {
        path: 'math.ts',
        previousPath: null,
        status: 'modified',
        additions: 4,
        deletions: 2,
        binary: false,
      },
    ]);
  });

  it('handles binary changed files', async () => {
    executeGitReadCommandMock
      .mockResolvedValueOnce({
        stdout: commitRecord(FOURTH_SHA, 'binary commit', THIRD_SHA),
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: 'A\0binary.dat\0',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: '-\t-\tbinary.dat\0',
        stderr: '',
      });

    const commit = await getGitCommit('alice', 'demo', FOURTH_SHA);

    expect(commit.stats).toEqual({
      additions: 0,
      deletions: 0,
      filesChanged: 1,
    });

    expect(commit.files[0]).toEqual({
      path: 'binary.dat',
      previousPath: null,
      status: 'added',
      additions: null,
      deletions: null,
      binary: true,
    });
  });

  it('handles a root commit with no parents', async () => {
    executeGitReadCommandMock
      .mockResolvedValueOnce({
        stdout: commitRecord(ROOT_SHA, 'root commit'),
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: 'A\0README.md\0',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: '3\t0\tREADME.md\0',
        stderr: '',
      });

    const commit = await getGitCommit('alice', 'demo', ROOT_SHA);

    expect(commit.parents).toEqual([]);
  });

  it('rejects invalid commit SHA before executing Git', async () => {
    await expect(getGitCommit('alice', 'demo', 'not-a-sha')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_GIT_COMMIT_SHA',
    });

    expect(executeGitReadCommandMock).not.toHaveBeenCalled();
  });

  it('maps a missing Git commit to 404', async () => {
    executeGitReadCommandMock.mockRejectedValueOnce(
      new GitReadError('Git command failed', 'GIT_READ_COMMAND_FAILED', {
        exitCode: 128,
        stderr: 'bad object',
      }),
    );

    await expect(getGitCommit('alice', 'demo', FOURTH_SHA)).rejects.toMatchObject({
      statusCode: 404,
      code: 'GIT_COMMIT_NOT_FOUND',
    });
  });

  it('rejects malformed Git commit data', async () => {
    executeGitReadCommandMock.mockResolvedValueOnce({
      stdout: 'invalid-data',
      stderr: '',
    });

    await expect(getGitCommit('alice', 'demo', FOURTH_SHA)).rejects.toBeInstanceOf(AppError);
  });
});
