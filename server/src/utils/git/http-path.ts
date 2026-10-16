import { AppError } from '../../errors/app.error.js';
import {
  resolveGitRepositoryPath,
  resolveOwnedGitRepositoryPath,
  type GitRepositoryOwner,
} from './repository-path.js';

const ALLOWED_GIT_HTTP_PATHS = new Set(['/info/refs', '/git-upload-pack', '/git-receive-pack']);

export const buildGitHttpPathInfo = (
  username: string,
  repositoryName: string,
  requestPath: string,
): string => {
  // Reuse the filesystem boundary validator so Git HTTP and repository
  // lifecycle operations share the same trusted repository identity rules.
  resolveGitRepositoryPath(username, repositoryName);

  if (!ALLOWED_GIT_HTTP_PATHS.has(requestPath)) {
    throw new AppError('Invalid Git HTTP path', 400, 'INVALID_GIT_HTTP_PATH');
  }

  return `/${username}/${repositoryName}.git${requestPath}`;
};

/**
 * Builds the internal PATH_INFO passed to git-http-backend.
 *
 * Public Git URLs are resolved separately by the HTTP controller.
 * Authorization must be completed before invoking the Git backend.
 */
export const buildOwnedGitHttpPathInfo = (
  owner: GitRepositoryOwner,
  repositoryName: string,
  requestPath: string,
): string => {
  // Validate the repository identity using the same rules as storage.
  resolveOwnedGitRepositoryPath(owner, repositoryName);

  if (!ALLOWED_GIT_HTTP_PATHS.has(requestPath)) {
    throw new AppError('Invalid Git HTTP path', 400, 'INVALID_GIT_HTTP_PATH');
  }

  if (owner.type === 'USER') {
    return buildGitHttpPathInfo(owner.username, repositoryName, requestPath);
  }

  return `/.organizations/${owner.slug}/${repositoryName}.git${requestPath}`;
};
