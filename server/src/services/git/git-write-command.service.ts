import { execFile } from 'node:child_process';

import { env } from '../../config/env.js';
import { GitWriteError } from '../../errors/git-write.error.js';
import { resolveGitRepositoryPath } from '../../utils/git/repository-path.js';

const STDERR_PREVIEW_LIMIT = 4096;

const GIT_CONFIG_GLOBAL_PATH = process.platform === 'win32' ? 'NUL' : '/dev/null';

type ExecuteGitWriteCommandInput = {
  username: string;
  repositoryName: string;
  args: readonly string[];
  stdin?: string;
};

export type GitWriteCommandResult = {
  stdout: string;
  stderr: string;
};

type ChildProcessFailure = Error & {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stderr?: string | Buffer;
};

const createSafeGitWriteEnvironment = (): NodeJS.ProcessEnv => ({
  PATH: env.GIT_CHILD_PATH,
  LANG: 'C',
  LC_ALL: 'C',

  /*
   * Never inherit the Node.js server environment.
   * Git mutation processes must not receive
   * database credentials, JWT secrets or tokens.
   */
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GIT_CONFIG_GLOBAL_PATH,
});

const getStderrPreview = (error: ChildProcessFailure): string => {
  const stderr = error.stderr === undefined ? '' : String(error.stderr);

  return stderr.slice(0, STDERR_PREVIEW_LIMIT);
};

const executeGitFile = (args: string[], stdin?: string): Promise<GitWriteCommandResult> => {
  return new Promise((resolve, reject) => {
    const child = execFile(
      env.GIT_EXECUTABLE_PATH,
      args,
      {
        encoding: 'utf8',
        timeout: env.GIT_READ_TIMEOUT_MS,
        maxBuffer: env.GIT_READ_MAX_BUFFER_BYTES,
        windowsHide: true,
        env: createSafeGitWriteEnvironment(),
      },
      (error, stdout, stderr) => {
        if (error) {
          const failure = error as ChildProcessFailure;

          if (stderr.length > 0 || failure.stderr === undefined) {
            failure.stderr = stderr;
          }

          reject(failure);
          return;
        }

        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );

    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
};

const mapGitWriteFailure = (error: unknown): GitWriteError => {
  const failure = error as ChildProcessFailure;

  const stderr = getStderrPreview(failure);

  if (failure.code === 'ENOENT') {
    return new GitWriteError('Git executable could not be found', 'GIT_EXECUTABLE_NOT_FOUND', {
      stderr,
      cause: error,
    });
  }

  if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new GitWriteError(
      'Git write output exceeded the configured limit',
      'GIT_WRITE_OUTPUT_LIMIT_EXCEEDED',
      {
        stderr,
        cause: error,
      },
    );
  }

  if (failure.killed === true || failure.signal === 'SIGTERM') {
    return new GitWriteError('Git write command timed out', 'GIT_WRITE_TIMEOUT', {
      stderr,
      cause: error,
    });
  }

  return new GitWriteError('Git write command failed', 'GIT_WRITE_COMMAND_FAILED', {
    exitCode: typeof failure.code === 'number' ? failure.code : null,
    stderr,
    cause: error,
  });
};

export const executeGitWriteCommand = async ({
  username,
  repositoryName,
  args,
  stdin,
}: ExecuteGitWriteCommandInput): Promise<GitWriteCommandResult> => {
  if (args.length === 0) {
    throw new GitWriteError('Git write command arguments are required', 'GIT_WRITE_COMMAND_FAILED');
  }

  if (stdin !== undefined && Buffer.byteLength(stdin, 'utf8') > env.GIT_READ_MAX_BUFFER_BYTES) {
    throw new GitWriteError(
      'Git write input exceeded the configured limit',
      'GIT_WRITE_COMMAND_FAILED',
    );
  }

  /*
   * Validate repository identity and filesystem
   * boundary before spawning Git.
   */
  const repositoryPath = resolveGitRepositoryPath(username, repositoryName);

  /*
   * Do NOT use --no-optional-locks here.
   * Mutation commands must retain Git locking.
   */
  const commandArgs = ['--no-pager', '--git-dir', repositoryPath, ...args];

  try {
    return await executeGitFile(commandArgs, stdin);
  } catch (error) {
    if (error instanceof GitWriteError) {
      throw error;
    }

    throw mapGitWriteFailure(error);
  }
};
