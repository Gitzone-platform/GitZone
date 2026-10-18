import type { RequestHandler } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { updateUserAvatar } from '../../services/profiles/avatar-profile.service.js';

export const uploadProfileAvatar: RequestHandler = async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (!userId) {
    throw new AppError('Authentication is required', 401, 'AUTHENTICATION_REQUIRED');
  }

  if (!req.file) {
    throw new AppError('Avatar image is required', 400, 'AVATAR_FILE_REQUIRED');
  }

  const user = await updateUserAvatar(userId, req.file.buffer, req.file.mimetype);

  res.status(200).json({
    success: true,
    data: {
      user,
    },
  });
};
