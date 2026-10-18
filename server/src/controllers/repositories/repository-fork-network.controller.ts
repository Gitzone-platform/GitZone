import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { getRepositoryForkNetwork } from '../../services/repositories/repository-fork-network.service.js';

export const getForkNetwork = async (req: Request, res: Response): Promise<void> => {
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  const userId = (req as Partial<AuthenticatedRequest>).userId;
  const network = await getRepositoryForkNetwork(username, name, userId);

  res.status(200).json({
    success: true,
    data: { network },
  });
};
