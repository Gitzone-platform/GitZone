import path from 'node:path';

import { AppError } from '../../errors/app.error.js';
import { env } from '../../config/env.js';

const GIT_STORAGE_ROOT = path.resolve(process.cwd(), env.GIT_STORAGE_PATH);

const SAFE_PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/;

const assertSafePathSegment = (value: string, field: 'username' | 'repository'): void => {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    value.includes('\0') ||
    !SAFE_PATH_SEGMENT_PATTERN.test(value)
  ) {
    throw new AppError(`Invalid Git ${field} path segment`, 400, 'INVALID_GIT_REPOSITORY_PATH');
  }
};

const assertInsideGitStorage = (targetPath: string): void => {
  const relativePath = path.relative(GIT_STORAGE_ROOT, targetPath);

  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new AppError(
      'Git repository path escapes storage root',
      400,
      'INVALID_GIT_REPOSITORY_PATH',
    );
  }
};

export const resolveGitRepositoryPath = (username: string, repositoryName: string): string => {
  assertSafePathSegment(username, 'username');
  assertSafePathSegment(repositoryName, 'repository');

  const repositoryPath = path.resolve(GIT_STORAGE_ROOT, username, `${repositoryName}.git`);

  assertInsideGitStorage(repositoryPath);

  return repositoryPath;
};

/**
 * Physical Git storage namespace.
 *
 * USER repositories retain their legacy storage layout.
 * ORGANIZATION repositories use an internal reserved directory
 * that cannot be registered as a username or organization slug.
 *
 * This function resolves paths only. Authorization must happen
 * independently before any filesystem operation.
 */
export type GitRepositoryOwner =
  { type: 'USER'; username: string } | { type: 'ORGANIZATION'; slug: string };

export const resolveOwnedGitRepositoryPath = (
  owner: GitRepositoryOwner,
  repositoryName: string,
): string => {
  if (owner.type === 'USER') {
    return resolveGitRepositoryPath(owner.username, repositoryName);
  }

  assertSafePathSegment(owner.slug, 'username');
  assertSafePathSegment(repositoryName, 'repository');

  const repositoryPath = path.resolve(
    GIT_STORAGE_ROOT,
    '.organizations',
    owner.slug,
    `${repositoryName}.git`,
  );

  assertInsideGitStorage(repositoryPath);

  return repositoryPath;
};
