import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';
import {
  getGitBlobContent,
  getGitBlobContentBySha,
  getGitRawBlob,
} from '../../services/git/git-content.service.js';
import { getGitCommit, listGitCommits } from '../../services/git/git-commit.service.js';
import {
  compareGitBranches,
  compareGitCommits,
  getGitCommitDiff,
} from '../../services/git/git-diff.service.js';
import {
  createGitBranch,
  deleteGitBranch,
  renameGitBranch,
} from '../../services/git/git-branch-mutation.service.js';
import { getGitBranch } from '../../services/git/git-branch.service.js';
import { getGitRepositoryRefs } from '../../services/git/git-ref.service.js';
import { getGitRepositoryReadme } from '../../services/git/git-readme.service.js';
import { authorizeRepositoryBranchWrite } from '../../services/repositories/repository-branch-access.service.js';
import { authorizeRepositoryContentRead } from '../../services/repositories/repository-content-access.service.js';
import {
  repositoryBranchQuerySchema,
  repositoryCommitsQuerySchema,
  repositoryCommitDiffQuerySchema,
  repositoryCompareCommitsQuerySchema,
  repositoryCompareBranchesQuerySchema,
  repositoryCreateBranchSchema,
  repositoryDeleteBranchQuerySchema,
  repositoryRenameBranchSchema,
  repositoryContentQuerySchema,
  repositoryReadmeQuerySchema,
} from '../../validations/repositories/repository-git.validation.js';

const repositoryParams = (req: Request): { username: string; name: string } => {
  const { username, name } = req.params;
  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }
  return { username, name };
};

const authorize = async (req: Request) => {
  const { username, name } = repositoryParams(req);
  const userId = (req as OptionalAuthenticatedRequest).userId;
  const access = await authorizeRepositoryContentRead(username, name, userId);
  return { access, username, name };
};

export const createBranch = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryCreateBranchSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid Git branch creation request', 400, 'INVALID_GIT_BRANCH_REQUEST');
  }

  const { username, name } = repositoryParams(req);

  const userId = (req as AuthenticatedRequest).userId;

  const access = await authorizeRepositoryBranchWrite(username, name, userId);

  const branch = await createGitBranch({
    username: access.repositoryOwnerUsername,
    repositoryName: access.repositoryName,
    branchName: parsed.data.name,
    ...(parsed.data.from !== undefined ? { from: parsed.data.from } : {}),
  });

  res.status(201).json({
    success: true,
    data: {
      branch,
    },
  });
};
export const getBranches = async (req: Request, res: Response): Promise<void> => {
  const { access } = await authorize(req);
  const refs = await getGitRepositoryRefs(access.repositoryOwnerUsername, access.repositoryName);
  res
    .status(200)
    .json({ success: true, data: { branches: refs.branches, defaultBranch: refs.defaultBranch } });
};

export const getBranch = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryBranchQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError('Invalid Git branch query', 400, 'INVALID_GIT_BRANCH_REQUEST');
  }

  const { access } = await authorize(req);

  const branchDetails = await getGitBranch(
    access.repositoryOwnerUsername,
    access.repositoryName,
    parsed.data.name,
  );

  res.status(200).json({
    success: true,
    data: {
      branch: branchDetails,
    },
  });
};
export const getContent = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryContentQuerySchema.safeParse(req.query);
  if (!parsed.success || parsed.data.path === undefined) {
    throw new AppError('A valid file path is required', 400, 'INVALID_GIT_FILE_PATH');
  }
  const { access } = await authorize(req);
  const content = await getGitBlobContent(
    access.repositoryOwnerUsername,
    access.repositoryName,
    parsed.data.ref,
    parsed.data.path,
  );
  res.status(200).json({ success: true, data: { content } });
};

export const getReadme = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryReadmeQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError('Invalid repository README query', 400, 'INVALID_GIT_README_QUERY');
  }

  const { access } = await authorize(req);

  const readme = await getGitRepositoryReadme(
    access.repositoryOwnerUsername,
    access.repositoryName,
    parsed.data.ref,
  );

  res.status(200).json({
    success: true,
    data: {
      readme,
    },
  });
};

export const getRawContent = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryContentQuerySchema.safeParse(req.query);

  if (!parsed.success || parsed.data.path === undefined) {
    throw new AppError('A valid file path is required', 400, 'INVALID_GIT_FILE_PATH');
  }

  const { access } = await authorize(req);

  const raw = await getGitRawBlob(
    access.repositoryOwnerUsername,
    access.repositoryName,
    parsed.data.ref,
    parsed.data.path,
  );

  res.status(200);

  res.setHeader('Content-Type', 'application/octet-stream');

  res.setHeader('Content-Length', String(raw.size));

  res.setHeader('X-Git-Blob-Oid', raw.oid);

  res.setHeader('X-Git-Ref', raw.ref);

  res.send(raw.content);
};
export const getCommits = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryCommitsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError('Invalid repository commits query', 400, 'INVALID_REPOSITORY_COMMITS_QUERY');
  }
  const { access } = await authorize(req);
  const commits = await listGitCommits(
    access.repositoryOwnerUsername,
    access.repositoryName,
    parsed.data.ref,
    parsed.data.path,
    parsed.data.page,
    parsed.data.perPage,
  );
  res.status(200).json({ success: true, data: { commits } });
};

export const getBlob = async (req: Request, res: Response): Promise<void> => {
  const { sha } = req.params;
  if (typeof sha !== 'string') {
    throw new AppError('Blob SHA is required', 400, 'INVALID_GIT_BLOB_SHA');
  }
  const { access } = await authorize(req);
  const blob = await getGitBlobContentBySha(
    access.repositoryOwnerUsername,
    access.repositoryName,
    sha,
  );
  res.status(200).json({ success: true, data: { blob } });
};

export const getCommit = async (req: Request, res: Response): Promise<void> => {
  const { sha } = req.params;
  if (typeof sha !== 'string') {
    throw new AppError('Commit SHA is required', 400, 'INVALID_GIT_COMMIT_SHA');
  }
  const { access } = await authorize(req);
  const commit = await getGitCommit(access.repositoryOwnerUsername, access.repositoryName, sha);
  res.status(200).json({ success: true, data: { commit } });
};

export const getCommitDiff = async (req: Request, res: Response): Promise<void> => {
  const { sha } = req.params;

  if (typeof sha !== 'string') {
    throw new AppError('Commit SHA is required', 400, 'INVALID_GIT_COMMIT_SHA');
  }

  const parsed = repositoryCommitDiffQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError('Invalid Git commit diff query', 400, 'INVALID_GIT_DIFF_QUERY');
  }

  const { access } = await authorize(req);

  const diff = await getGitCommitDiff(
    access.repositoryOwnerUsername,
    access.repositoryName,
    sha,
    parsed.data.maxBytes,
  );

  res.status(200).json({
    success: true,
    data: { diff },
  });
};

export const compareCommits = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryCompareCommitsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError('Invalid Git commit comparison query', 400, 'INVALID_GIT_COMPARE_QUERY');
  }

  const { access } = await authorize(req);

  const comparison = await compareGitCommits(
    access.repositoryOwnerUsername,
    access.repositoryName,
    parsed.data.base,
    parsed.data.head,
    parsed.data.maxBytes,
  );

  res.status(200).json({
    success: true,
    data: { comparison },
  });
};

export const compareBranches = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryCompareBranchesQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError('Invalid Git branch comparison query', 400, 'INVALID_GIT_COMPARE_QUERY');
  }

  const { access } = await authorize(req);

  const comparison = await compareGitBranches(
    access.repositoryOwnerUsername,
    access.repositoryName,
    parsed.data.base,
    parsed.data.head,
    parsed.data.maxBytes,
  );

  res.status(200).json({
    success: true,
    data: { comparison },
  });
};
export const deleteBranch = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryDeleteBranchQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError('Invalid Git branch deletion request', 400, 'INVALID_GIT_BRANCH_REQUEST');
  }

  const { username, name } = repositoryParams(req);

  const userId = (req as AuthenticatedRequest).userId;

  const access = await authorizeRepositoryBranchWrite(username, name, userId);

  await deleteGitBranch({
    username: access.repositoryOwnerUsername,
    repositoryName: access.repositoryName,
    branchName: parsed.data.name,
  });

  res.status(204).send();
};
export const renameBranch = async (req: Request, res: Response): Promise<void> => {
  const parsed = repositoryRenameBranchSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid Git branch rename request', 400, 'INVALID_GIT_BRANCH_REQUEST');
  }

  const { username, name } = repositoryParams(req);

  const userId = (req as AuthenticatedRequest).userId;

  const access = await authorizeRepositoryBranchWrite(username, name, userId);

  const branch = await renameGitBranch({
    username: access.repositoryOwnerUsername,
    repositoryName: access.repositoryName,
    branchName: parsed.data.name,
    newBranchName: parsed.data.newName,
  });

  res.status(200).json({
    success: true,
    data: {
      branch,
    },
  });
};
