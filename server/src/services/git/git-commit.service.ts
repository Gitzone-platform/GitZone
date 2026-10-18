import { AppError } from '../../errors/app.error.js';
import { GitReadError } from '../../errors/git-read.error.js';
import { assertSafeGitTreePath } from '../../utils/git/tree-path.js';
import { executeGitReadCommand } from './git-read-command.service.js';
import { getGitRepositoryRefs, type GitReference } from './git-ref.service.js';

export type GitCommitIdentity = {
  name: string;
  email: string;
  date: string;
};

export type GitCommitSummary = {
  sha: string;
  author: GitCommitIdentity;
  committer: GitCommitIdentity;
  message: string;
  parents: string[];
};

export type GitCommitFileStatus =
  'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'unmerged' | 'unknown';

export type GitCommitChangedFile = {
  path: string;
  previousPath: string | null;
  status: GitCommitFileStatus;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
};

export type GitCommitStatistics = {
  additions: number;
  deletions: number;
  filesChanged: number;
};

export type GitCommitDetail = GitCommitSummary & {
  stats: GitCommitStatistics;
  files: GitCommitChangedFile[];
};

const FIELD_SEPARATOR = '\x1f';
const RECORD_SEPARATOR = '\x1e';

const commitFormat = `%H${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%cn${FIELD_SEPARATOR}%ce${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%P`;

const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

const invalidCommitData = (): AppError =>
  new AppError('Git repository contains invalid commit data', 500, 'GIT_COMMIT_DATA_INVALID');

const parseCommit = (record: string): GitCommitSummary => {
  const fields = record.replace(/\r?\n$/, '').split(FIELD_SEPARATOR);

  if (fields.length !== 9) {
    throw invalidCommitData();
  }

  const field = (index: number): string => {
    const value = fields[index];

    if (value === undefined) {
      throw invalidCommitData();
    }

    return value;
  };

  const sha = field(0);

  if (!SHA_PATTERN.test(sha)) {
    throw invalidCommitData();
  }

  const parentsValue = field(8).trim();

  const parents =
    parentsValue.length === 0
      ? []
      : parentsValue.split(/\s+/).map((parent) => {
          if (!SHA_PATTERN.test(parent)) {
            throw invalidCommitData();
          }

          return parent;
        });

  return {
    sha,
    author: {
      name: field(1),
      email: field(2),
      date: field(3),
    },
    committer: {
      name: field(4),
      email: field(5),
      date: field(6),
    },
    message: field(7),
    parents,
  };
};

const resolveReference = (
  refs: Awaited<ReturnType<typeof getGitRepositoryRefs>>,
  requested: string | undefined,
): GitReference => {
  const result =
    requested === undefined
      ? refs.head
      : (refs.branches.find((ref) => ref.name === requested) ??
        refs.tags.find((ref) => ref.name === requested));

  if (!result) {
    throw new AppError('Git reference not found', 404, 'GIT_REF_NOT_FOUND');
  }

  return result;
};

const mapFileStatus = (statusCode: string): GitCommitFileStatus => {
  switch (statusCode.charAt(0)) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'unmerged';
    default:
      return 'unknown';
  }
};

type ParsedNameStatus = {
  path: string;
  previousPath: string | null;
  status: GitCommitFileStatus;
};

const parseNameStatus = (output: string): ParsedNameStatus[] => {
  if (output.length === 0) {
    return [];
  }

  const tokens = output.split('\0');

  if (tokens.at(-1) === '') {
    tokens.pop();
  }

  const files: ParsedNameStatus[] = [];

  for (let index = 0; index < tokens.length;) {
    const statusToken = tokens[index];

    if (statusToken === undefined || statusToken.length === 0) {
      throw invalidCommitData();
    }

    const status = mapFileStatus(statusToken);

    if (status === 'renamed' || status === 'copied') {
      const previousPath = tokens[index + 1];
      const path = tokens[index + 2];

      if (
        previousPath === undefined ||
        path === undefined ||
        previousPath.length === 0 ||
        path.length === 0
      ) {
        throw invalidCommitData();
      }

      files.push({
        path,
        previousPath,
        status,
      });

      index += 3;
      continue;
    }

    const path = tokens[index + 1];

    if (path === undefined || path.length === 0) {
      throw invalidCommitData();
    }

    files.push({
      path,
      previousPath: null,
      status,
    });

    index += 2;
  }

  return files;
};

type ParsedNumstat = {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
};

const parseNumstat = (output: string): Map<string, ParsedNumstat> => {
  const result = new Map<string, ParsedNumstat>();

  if (output.length === 0) {
    return result;
  }

  const records = output.split('\0');

  if (records.at(-1) === '') {
    records.pop();
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record === undefined || record.length === 0) {
      continue;
    }

    const firstTab = record.indexOf('\t');
    const secondTab = firstTab === -1 ? -1 : record.indexOf('\t', firstTab + 1);

    if (firstTab === -1 || secondTab === -1) {
      throw invalidCommitData();
    }

    const additionsRaw = record.slice(0, firstTab);
    const deletionsRaw = record.slice(firstTab + 1, secondTab);
    let path = record.slice(secondTab + 1);

    if (path.length === 0) {
      const previousPath = records[index + 1];
      const renamedPath = records[index + 2];

      if (
        previousPath === undefined ||
        renamedPath === undefined ||
        previousPath.length === 0 ||
        renamedPath.length === 0
      ) {
        throw invalidCommitData();
      }

      path = renamedPath;
      index += 2;
    }

    const binary = additionsRaw === '-' && deletionsRaw === '-';

    if (binary) {
      result.set(path, {
        additions: null,
        deletions: null,
        binary: true,
      });

      continue;
    }

    const additions = Number(additionsRaw);
    const deletions = Number(deletionsRaw);

    if (
      !Number.isSafeInteger(additions) ||
      additions < 0 ||
      !Number.isSafeInteger(deletions) ||
      deletions < 0
    ) {
      throw invalidCommitData();
    }

    result.set(path, {
      additions,
      deletions,
      binary: false,
    });
  }

  return result;
};

const buildChangedFiles = (
  nameStatusOutput: string,
  numstatOutput: string,
): GitCommitChangedFile[] => {
  const statusFiles = parseNameStatus(nameStatusOutput);
  const stats = parseNumstat(numstatOutput);

  return statusFiles.map((file) => {
    const fileStats = stats.get(file.path);

    if (fileStats === undefined) {
      return {
        ...file,
        additions: null,
        deletions: null,
        binary: true,
      };
    }

    return {
      ...file,
      additions: fileStats.additions,
      deletions: fileStats.deletions,
      binary: fileStats.binary,
    };
  });
};

const buildStatistics = (files: GitCommitChangedFile[]): GitCommitStatistics => {
  let additions = 0;
  let deletions = 0;

  for (const file of files) {
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }

  return {
    additions,
    deletions,
    filesChanged: files.length,
  };
};

export const listGitCommits = async (
  username: string,
  repositoryName: string,
  requestedRef: string | undefined,
  path: string | undefined,
  page: number,
  perPage: number,
): Promise<GitCommitSummary[]> => {
  if (path !== undefined) {
    assertSafeGitTreePath(path);
  }

  try {
    const refs = await getGitRepositoryRefs(username, repositoryName);

    const ref = resolveReference(refs, requestedRef);

    const args = [
      'log',
      `--max-count=${perPage}`,
      `--skip=${(page - 1) * perPage}`,
      `--format=${RECORD_SEPARATOR}${commitFormat}`,
      '--end-of-options',
      ref.fullName,
    ];

    if (path) {
      args.push('--', path);
    }

    const output = (
      await executeGitReadCommand({
        username,
        repositoryName,
        args,
      })
    ).stdout;

    return output.split(RECORD_SEPARATOR).filter(Boolean).map(parseCommit);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('Failed to read Git commit history', 500, 'GIT_COMMIT_HISTORY_READ_FAILED');
  }
};

export const getGitCommit = async (
  username: string,
  repositoryName: string,
  sha: string,
): Promise<GitCommitDetail> => {
  if (!SHA_PATTERN.test(sha)) {
    throw new AppError('Invalid commit SHA', 400, 'INVALID_GIT_COMMIT_SHA');
  }

  try {
    const metadata = await executeGitReadCommand({
      username,
      repositoryName,
      args: ['show', '-s', `--format=${commitFormat}`, '--end-of-options', sha],
    });

    const commit = parseCommit(metadata.stdout.trim());

    const nameStatus = await executeGitReadCommand({
      username,
      repositoryName,
      args: [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--name-status',
        '-z',
        '-M',
        '-C',
        '--no-ext-diff',
        '--end-of-options',
        sha,
      ],
    });

    const numstat = await executeGitReadCommand({
      username,
      repositoryName,
      args: [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--numstat',
        '-z',
        '-M',
        '-C',
        '--no-ext-diff',
        '--end-of-options',
        sha,
      ],
    });

    const files = buildChangedFiles(nameStatus.stdout, numstat.stdout);

    return {
      ...commit,
      stats: buildStatistics(files),
      files,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (
      error instanceof GitReadError &&
      error.code === 'GIT_READ_COMMAND_FAILED' &&
      error.exitCode === 128
    ) {
      throw new AppError('Git commit not found', 404, 'GIT_COMMIT_NOT_FOUND');
    }

    throw new AppError('Failed to read Git commit', 500, 'GIT_COMMIT_READ_FAILED');
  }
};
