import type { RequestHandler } from 'express';

import { AppError } from '../../errors/app.error.js';
import { readStoredAvatar } from '../../services/profiles/avatar-read.service.js';

export const getProfileAvatar: RequestHandler = async (req, res) => {
  const filename = req.params.filename;

  if (typeof filename !== 'string') {
    throw new AppError('Invalid avatar filename', 400, 'INVALID_AVATAR_FILENAME');
  }

  const buffer = await readStoredAvatar(filename);

  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('Content-Length', buffer.length);

  res.status(200).send(buffer);
};
