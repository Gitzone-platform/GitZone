import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';
import { getUserStarredRepositories } from '../../services/profiles/profile-starred.service.js';
import { profileUsernameSchema } from '../../validations/profiles/profile.validation.js';
import { profileStarredQuerySchema } from '../../validations/profiles/profile-starred.validation.js';

export const getProfileStarredRepositories = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const parsedUsername = profileUsernameSchema.safeParse(req.params.username);

  if (!parsedUsername.success) {
    throw new AppError('Invalid username', 400, 'INVALID_USERNAME');
  }

  const parsedQuery = profileStarredQuerySchema.safeParse(req.query);

  if (!parsedQuery.success) {
    throw new AppError(
      'Invalid starred repositories query',
      400,
      'INVALID_STARRED_QUERY',
    );
  }

  const viewerId = (req as OptionalAuthenticatedRequest).userId;

  const result = await getUserStarredRepositories(
    parsedUsername.data,
    viewerId,
    parsedQuery.data,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
};
