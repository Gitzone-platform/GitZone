import { AppError } from '../../errors/app.error.js';
import { GitReadError } from '../../errors/git-read.error.js';
import { GitWriteError } from '../../errors/git-write.error.js';
import { isSafeGitRefName } from '../../utils/git/ref-name.js';
import { executeGitReadCommand } from './git-read-command.service.js';
import { getGitRepositoryRefs, type GitReference } from './git-ref.service.js';
import { executeGitWriteCommand } from './git-write-command.service.js';

const ZERO_SHA1 = '0000000000000000000000000000000000000000';

const ZERO_SHA256 = '0000000000000000000000000000000000000000000000000000000000000000';

export type CreateGitBranchInput = {
  username: string;
  repositoryName: string;
  branchName: string;
  from?: string;
};

export type CreatedGitBranch = GitReference & {
  isDefault: boolean;
};

const validateBranchName = async (
  username: string,
  repositoryName: string,
  branchName: string,
): Promise<void> => {
  if (!isSafeGitRefName(branchName)) {
    throw new AppError('Invalid Git branch name', 400, 'INVALID_GIT_BRANCH_NAME');
  }

  try {
    await executeGitReadCommand({
      username,
      repositoryName,
      args: ['check-ref-format', '--branch', branchName],
    });
  } catch (error) {
    if (error instanceof GitReadError && error.code === 'GIT_READ_COMMAND_FAILED') {
      throw new AppError('Invalid Git branch name', 400, 'INVALID_GIT_BRANCH_NAME');
    }

    throw error;
  }
};

const getZeroOid = (objectFormat: 'sha1' | 'sha256'): string =>
  objectFormat === 'sha256' ? ZERO_SHA256 : ZERO_SHA1;

export const createGitBranch = async ({
  username,
  repositoryName,
  branchName,
  from,
}: CreateGitBranchInput): Promise<CreatedGitBranch> => {
  await validateBranchName(username, repositoryName, branchName);

  if (from !== undefined) {
    await validateBranchName(username, repositoryName, from);
  }

  const refs = await getGitRepositoryRefs(username, repositoryName);

  if (refs.branches.some((branch) => branch.name === branchName)) {
    throw new AppError('Git branch already exists', 409, 'GIT_BRANCH_ALREADY_EXISTS');
  }

  const sourceBranchName = from ?? refs.defaultBranch;

  const sourceBranch = refs.branches.find((branch) => branch.name === sourceBranchName);

  if (!sourceBranch) {
    throw new AppError('Source Git branch not found', 404, 'GIT_SOURCE_BRANCH_NOT_FOUND');
  }

  const fullName = `refs/heads/${branchName}`;

  try {
    await executeGitWriteCommand({
      username,
      repositoryName,
      args: ['update-ref', fullName, sourceBranch.oid, getZeroOid(refs.objectFormat)],
    });
  } catch (error) {
    if (error instanceof GitWriteError && error.code === 'GIT_WRITE_COMMAND_FAILED') {
      /*
       * update-ref uses compare-and-swap semantics.
       * A concurrent creator may have created this
       * ref after the initial refs snapshot.
       */
      throw new AppError('Git branch creation conflict', 409, 'GIT_BRANCH_CONFLICT');
    }

    throw error;
  }

  return {
    name: branchName,
    fullName,
    oid: sourceBranch.oid,
    objectType: sourceBranch.objectType,
    isDefault: false,
  };
};

export type DeleteGitBranchInput = {
  username: string;
  repositoryName: string;
  branchName: string;
};

export const deleteGitBranch = async ({
  username,
  repositoryName,
  branchName,
}: DeleteGitBranchInput): Promise<void> => {
  if (!isSafeGitRefName(branchName)) {
    throw new AppError('Invalid Git branch name', 400, 'INVALID_GIT_BRANCH_NAME');
  }

  try {
    await executeGitReadCommand({
      username,
      repositoryName,
      args: ['check-ref-format', '--branch', branchName],
    });
  } catch {
    throw new AppError('Invalid Git branch name', 400, 'INVALID_GIT_BRANCH_NAME');
  }

  const refs = await getGitRepositoryRefs(username, repositoryName);

  const branch = refs.branches.find((reference) => reference.name === branchName);

  if (!branch) {
    throw new AppError('Git branch not found', 404, 'GIT_BRANCH_NOT_FOUND');
  }

  if (branch.name === refs.defaultBranch) {
    throw new AppError('Default branch cannot be deleted', 409, 'GIT_DEFAULT_BRANCH_PROTECTED');
  }

  try {
    await executeGitWriteCommand({
      username,
      repositoryName,
      args: ['update-ref', '-d', branch.fullName, branch.oid],
    });
  } catch (error) {
    if (error instanceof GitWriteError && error.code === 'GIT_WRITE_COMMAND_FAILED') {
      throw new AppError('Git branch deletion conflict', 409, 'GIT_BRANCH_CONFLICT');
    }

    throw error;
  }
};
export type RenameGitBranchInput = {
  username: string;
  repositoryName: string;
  branchName: string;
  newBranchName: string;
};

export const renameGitBranch = async ({
  username,
  repositoryName,
  branchName,
  newBranchName,
}: RenameGitBranchInput): Promise<GitReference> => {
  await validateBranchName(username, repositoryName, branchName);

  await validateBranchName(username, repositoryName, newBranchName);

  const refs = await getGitRepositoryRefs(username, repositoryName);

  const branch = refs.branches.find((reference) => reference.name === branchName);

  if (!branch) {
    throw new AppError('Git branch not found', 404, 'GIT_BRANCH_NOT_FOUND');
  }

  if (branch.name === refs.defaultBranch) {
    throw new AppError('Default branch cannot be renamed', 409, 'GIT_DEFAULT_BRANCH_PROTECTED');
  }

  const existingTarget = refs.branches.find((reference) => reference.name === newBranchName);

  if (existingTarget) {
    throw new AppError('Git branch already exists', 409, 'GIT_BRANCH_ALREADY_EXISTS');
  }

  const newFullName = `refs/heads/${newBranchName}`;

  const transaction = [
    `create ${newFullName} ${branch.oid}`,
    `delete ${branch.fullName} ${branch.oid}`,
    '',
  ].join('\n');

  try {
    await executeGitWriteCommand({
      username,
      repositoryName,
      args: ['update-ref', '--stdin'],
      stdin: transaction,
    });
  } catch (error) {
    if (error instanceof GitWriteError && error.code === 'GIT_WRITE_COMMAND_FAILED') {
      throw new AppError('Git branch rename conflict', 409, 'GIT_BRANCH_CONFLICT');
    }

    throw error;
  }

  return {
    name: newBranchName,
    fullName: newFullName,
    oid: branch.oid,
    objectType: branch.objectType,
  };
};
