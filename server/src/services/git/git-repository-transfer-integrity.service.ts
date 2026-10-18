import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export type GitRepositoryIntegrityResult = {
  valid: boolean;
  bare: boolean;
  fsckPassed: boolean;
  reason: string | null;
};

export const verifyGitRepositoryIntegrity = async (
  repositoryPath: string,
): Promise<GitRepositoryIntegrityResult> => {
  const invalid = (reason: string, bare = false): GitRepositoryIntegrityResult => ({
    valid: false,
    bare,
    fsckPassed: false,
    reason,
  });

  try {
    const stats = await fs.lstat(repositoryPath);

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return invalid('UNSAFE_REPOSITORY_DIRECTORY');
    }
  } catch {
    return invalid('REPOSITORY_NOT_ACCESSIBLE');
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['--git-dir', repositoryPath, 'rev-parse', '--is-bare-repository'],
      {
        timeout: 15000,
        windowsHide: true,
      },
    );

    if (stdout.trim() !== 'true') {
      return invalid('NOT_BARE_REPOSITORY');
    }
  } catch {
    return invalid('INVALID_GIT_REPOSITORY');
  }

  try {
    await execFileAsync('git', ['--git-dir', repositoryPath, 'fsck', '--full', '--no-reflogs'], {
      timeout: 60000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });

    return {
      valid: true,
      bare: true,
      fsckPassed: true,
      reason: null,
    };
  } catch {
    return invalid('GIT_FSCK_FAILED', true);
  }
};
