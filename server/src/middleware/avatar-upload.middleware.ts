import multer from 'multer';

import { AppError } from '../errors/app.error.js';

export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const avatarUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_AVATAR_SIZE_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },

  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new AppError('Unsupported avatar file type', 415, 'INVALID_AVATAR_TYPE'));

      return;
    }

    callback(null, true);
  },
});

export const uploadAvatar = avatarUpload.single('avatar');
