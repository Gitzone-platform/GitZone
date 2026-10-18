import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import { withGitUserWriteLock } from '../../services/git/git-user-lock.service.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import {
  createRepository,
  deleteRepository,
  getRepositoryByUsernameAndName,
  getUserRepositories,
  updateRepository,
} from '../../services/repositories/repository.service.js';
import {
  addRepositoryCollaborator,
  getRepositoryCollaborators,
  updateRepositoryCollaborator,
  removeRepositoryCollaborator,
} from '../../services/repositories/repository-collaborator.service.js';
import {
  addRepositoryCollaboratorSchema,
  createRepositorySchema,
  updateRepositoryCollaboratorSchema,
  updateRepositorySchema,
} from '../../validations/repositories/repository.validation.js';

export const create = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;

  const parsed = createRepositorySchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid repository data', 400, 'INVALID_REPOSITORY_DATA');
  }

  const repository = await withGitUserWriteLock(authenticatedReq.userId, () =>
    createRepository(authenticatedReq.userId, parsed.data),
  );

  res.status(201).json({
    success: true,
    data: {
      repository,
    },
  });
};

export const listByUsername = async (req: Request, res: Response): Promise<void> => {
  const { username } = req.params;

  if (typeof username !== 'string') {
    throw new AppError('Username is required', 400, 'INVALID_USERNAME');
  }

  const repositories = await getUserRepositories(username);

  res.status(200).json({
    success: true,
    data: {
      repositories,
    },
  });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const repository = await getRepositoryByUsernameAndName(username, name);

  res.status(200).json({
    success: true,
    data: {
      repository,
    },
  });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const parsed = updateRepositorySchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid repository data', 400, 'INVALID_REPOSITORY_DATA');
  }

  const repository = await withGitUserWriteLock(authenticatedReq.userId, () =>
    updateRepository(authenticatedReq.userId, username, name, parsed.data),
  );

  res.status(200).json({
    success: true,
    data: {
      repository,
    },
  });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  await withGitUserWriteLock(authenticatedReq.userId, () =>
    deleteRepository(authenticatedReq.userId, username, name),
  );

  res.status(200).json({
    success: true,
    message: 'Repository deleted successfully',
  });
};

export const addCollaborator = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;

  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const parsed = addRepositoryCollaboratorSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid collaborator data', 400, 'INVALID_COLLABORATOR_DATA');
  }

  const collaborator = await addRepositoryCollaborator(
    authenticatedReq.userId,
    username,
    name,
    parsed.data.username,
    parsed.data.permission,
  );

  res.status(201).json({
    success: true,
    data: {
      collaborator,
    },
  });
};

export const listCollaborators = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;

  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const collaborators = await getRepositoryCollaborators(authenticatedReq.userId, username, name);

  res.status(200).json({
    success: true,
    data: {
      collaborators,
    },
  });
};

export const updateCollaborator = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;

  const { username, name, collaboratorUsername } = req.params;

  if (
    typeof username !== 'string' ||
    typeof name !== 'string' ||
    typeof collaboratorUsername !== 'string'
  ) {
    throw new AppError(
      'Username, repository name and collaborator username are required',
      400,
      'INVALID_COLLABORATOR_PARAMS',
    );
  }

  const parsed = updateRepositoryCollaboratorSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid collaborator data', 400, 'INVALID_COLLABORATOR_DATA');
  }

  const collaborator = await updateRepositoryCollaborator(
    authenticatedReq.userId,
    username,
    name,
    collaboratorUsername,
    parsed.data.permission,
  );

  res.status(200).json({
    success: true,
    data: {
      collaborator,
    },
  });
};

export const removeCollaborator = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;

  const { username, name, collaboratorUsername } = req.params;

  if (
    typeof username !== 'string' ||
    typeof name !== 'string' ||
    typeof collaboratorUsername !== 'string'
  ) {
    throw new AppError(
      'Username, repository name and collaborator username are required',
      400,
      'INVALID_COLLABORATOR_PARAMS',
    );
  }

  await removeRepositoryCollaborator(authenticatedReq.userId, username, name, collaboratorUsername);

  res.status(200).json({
    success: true,
    message: 'Repository collaborator removed successfully',
  });
};
