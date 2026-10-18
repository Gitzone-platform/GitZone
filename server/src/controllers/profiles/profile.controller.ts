import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import {
  getPublicUserProfile,
  updateUserProfile,
} from '../../services/profiles/profile.service.js';
import { getUserRepositories } from '../../services/repositories/repository.service.js';
import { getUserPublicActivity } from '../../services/profiles/profile-activity.service.js';
import { getUserPublicContributions } from '../../services/profiles/profile-contributions.service.js';
import {
  profileUsernameSchema,
  updateProfileSchema,
} from '../../validations/profiles/profile.validation.js';

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  const parsed = profileUsernameSchema.safeParse(req.params.username);

  if (!parsed.success) {
    throw new AppError('Invalid username', 400, 'INVALID_USERNAME');
  }

  const user = await getPublicUserProfile(parsed.data);

  res.status(200).json({
    success: true,
    data: {
      user,
    },
  });
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;

  const parsed = updateProfileSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid profile data', 400, 'INVALID_PROFILE_DATA');
  }

  const user = await updateUserProfile(authenticatedReq.userId, parsed.data);

  res.status(200).json({
    success: true,
    data: {
      user,
    },
  });
};

export const getProfileRepositories = async (req: Request, res: Response): Promise<void> => {
  const parsed = profileUsernameSchema.safeParse(req.params.username);

  if (!parsed.success) {
    throw new AppError('Invalid username', 400, 'INVALID_USERNAME');
  }

  const username = parsed.data;

  await getPublicUserProfile(username);

  const repositories = await getUserRepositories(username);

  res.status(200).json({
    success: true,
    data: {
      repositories,
    },
  });
};

export const getProfileActivity = async (req: Request, res: Response): Promise<void> => {
  const parsed = profileUsernameSchema.safeParse(req.params.username);

  if (!parsed.success) {
    throw new AppError('Invalid username', 400, 'INVALID_USERNAME');
  }

  const result = await getUserPublicActivity(parsed.data);

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const getProfileContributions = async (req: Request, res: Response): Promise<void> => {
  const parsed = profileUsernameSchema.safeParse(req.params.username);

  if (!parsed.success) {
    throw new AppError('Invalid username', 400, 'INVALID_USERNAME');
  }

  const result = await getUserPublicContributions(parsed.data);

  res.status(200).json({
    success: true,
    data: result,
  });
};
