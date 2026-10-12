import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { unwatchRepository, watchRepository } from '../../services/repositories/repository-watch.service.js';

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
