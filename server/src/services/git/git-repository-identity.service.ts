import { AppError } from '../../errors/app.error.js';
import type { GitRepositoryLookupResult } from './git-repository-lookup.service.js';

const repositoryNotFound = (): AppError =>
  new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');

export const assertGitRepositoryIdentity = (
  initial: GitRepositoryLookupResult,
  current: GitRepositoryLookupResult,
): void => {
  if (
    initial.id !== current.id ||
    initial.name !== current.name ||
    initial.owner.type !== current.owner.type ||
    initial.owner.id !== current.owner.id ||
    initial.owner.name !== current.owner.name
  ) {
    throw repositoryNotFound();
  }
};