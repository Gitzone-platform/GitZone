import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { withGitUserWriteLock } from '../../services/git/git-user-lock.service.js';
import { forkRepository } from '../../services/repositories/repository-fork.service.js';
import { forkRepositorySchema } from '../../validations/repositories/repository-fork.validation.js';

export const fork = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Source username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const parsed = forkRepositorySchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid fork data', 400, 'INVALID_FORK_DATA');
  }

  const repository = await withGitUserWriteLock(authenticatedReq.userId, () =>
    forkRepository(authenticatedReq.userId, username, name, parsed.data),
  );

  res.status(201).json({
    success: true,
    data: {
      repository,
    },
  });
};
