import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import {
  unwatchRepository,
  updateRepositoryWatchPreference,
  watchRepository,
} from '../../services/repositories/repository-watch.service.js';
import { getRepositoryWatcherCount } from '../../services/repositories/repository-watch.service.js';
import { updateRepositoryWatchPreferencesSchema } from '../../validations/repositories/repository-watch-preferences.validation.js';

export const watch = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const result = await watchRepository(
    authenticatedReq.userId,
    username,
    name,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const unwatch = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const result = await unwatchRepository(
    authenticatedReq.userId,
    username,
    name,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const updateWatchPreference = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const parsed = updateRepositoryWatchPreferencesSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(
      'Invalid watch preference',
      400,
      'INVALID_WATCH_PREFERENCE',
    );
  }

  const result = await updateRepositoryWatchPreference(
    authenticatedReq.userId,
    username,
    name,
    parsed.data.preference,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const getWatcherCount = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const result = await getRepositoryWatcherCount(
    username,
    name,
    (req as Request & { userId?: string }).userId,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
};
