import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { getRepositoryStarCount, starRepository, unstarRepository } from '../../services/repositories/repository-star.service.js';

export const star = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const result = await starRepository(authenticatedReq.userId, username, name);

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const unstar = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const result = await unstarRepository(
    authenticatedReq.userId,
    username,
    name,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const getStarCount = async (
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

  const userId = (req as Request & { userId?: string }).userId;

  const result = await getRepositoryStarCount(
    username,
    name,
    userId,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
};
