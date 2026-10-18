import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  compareGitBranches,
  compareGitCommits,
  getGitCommitDiff,
} from '../../../src/services/git/git-diff.service.js';
import { executeGitReadCommand } from '../../../src/services/git/git-read-command.service.js';
import { getGitRepositoryRefs } from '../../../src/services/git/git-ref.service.js';

vi.mock('../../../src/services/git/git-read-command.service.js', () => ({
  executeGitReadCommand: vi.fn(),
}));

vi.mock('../../../src/services/git/git-ref.service.js', () => ({
  getGitRepositoryRefs: vi.fn(),
}));

const executeMock = vi.mocked(executeGitReadCommand);
const refsMock = vi.mocked(getGitRepositoryRefs);

const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const MERGE_BASE = '3'.repeat(40);

describe('git diff service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    refsMock.mockResolvedValue({
      objectFormat: 'sha1',
      symbolicHead: 'refs/heads/main',
      defaultBranch: 'main',
      head: {
        name: 'main',
        fullName: 'refs/heads/main',
        oid: BASE,
        objectType: 'commit',
      },
      branches: [
        {
          name: 'main',
          fullName: 'refs/heads/main',
          oid: BASE,
          objectType: 'commit',
        },
        {
          name: 'feature/compare',
          fullName: 'refs/heads/feature/compare',
          oid: HEAD,
          objectType: 'commit',
        },
      ],
      tags: [],
    });
  });

  it('returns a unified commit diff', async () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n');

    executeMock.mockResolvedValueOnce({
      stdout: diff,
      stderr: '',
    });

    const result = await getGitCommitDiff('alice', 'demo', HEAD);

    expect(result.diff).toBe(diff);
    expect(result.size).toBe(Buffer.byteLength(diff, 'utf8'));
    expect(result.truncated).toBe(false);
    expect(result.binary).toBe(false);
  });

  it('detects a Git binary patch', async () => {
    const diff = [
      'diff --git a/image.dat b/image.dat',
      'new file mode 100644',
      'index 0000000..1234567',
      'GIT binary patch',
      'literal 4',
      'LcmeAS@N?(olHy`u',
      '',
    ].join('\n');

    executeMock.mockResolvedValueOnce({
      stdout: diff,
      stderr: '',
    });

    const result = await getGitCommitDiff('alice', 'demo', HEAD);

    expect(result.binary).toBe(true);
  });

  it('truncates a large diff at the configured limit', async () => {
    const diff = 'a'.repeat(4096);

    executeMock.mockResolvedValueOnce({
      stdout: diff,
      stderr: '',
    });

    const result = await getGitCommitDiff('alice', 'demo', HEAD, 1024);

    expect(result.size).toBe(4096);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.diff, 'utf8')).toBeLessThanOrEqual(1024);
  });

  it('rejects an invalid diff limit', async () => {
    await expect(getGitCommitDiff('alice', 'demo', HEAD, 100)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_GIT_DIFF_LIMIT',
    });

    expect(executeMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid commit SHA', async () => {
    await expect(getGitCommitDiff('alice', 'demo', 'bad-sha')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_GIT_COMMIT_SHA',
    });
  });

  it('compares two commits', async () => {
    executeMock
      .mockResolvedValueOnce({
        stdout: '2\t3\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: `${MERGE_BASE}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: 'diff --git a/a.txt b/a.txt\n',
        stderr: '',
      });

    const result = await compareGitCommits('alice', 'demo', BASE, HEAD);

    expect(result).toMatchObject({
      base: BASE,
      head: HEAD,
      mergeBase: MERGE_BASE,
      aheadBy: 3,
      behindBy: 2,
    });

    expect(result.diff.truncated).toBe(false);
  });

  it('compares two branches using exact refs', async () => {
    executeMock
      .mockResolvedValueOnce({
        stdout: '2\t1\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: `${MERGE_BASE}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: 'diff --git a/a.txt b/a.txt\n',
        stderr: '',
      });

    const result = await compareGitBranches('alice', 'demo', 'main', 'feature/compare');

    expect(result.base).toBe('refs/heads/main');
    expect(result.head).toBe('refs/heads/feature/compare');

    expect(result.aheadBy).toBe(1);
    expect(result.behindBy).toBe(2);
  });

  it('rejects an unknown comparison branch', async () => {
    await expect(compareGitBranches('alice', 'demo', 'main', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'GIT_REF_NOT_FOUND',
    });
  });

  it('rejects an unsafe branch name', async () => {
    await expect(
      compareGitBranches('alice', 'demo', '../main', 'feature/compare'),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_GIT_REF',
    });

    expect(executeMock).not.toHaveBeenCalled();
  });
});
