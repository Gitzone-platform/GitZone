import { MulterError } from 'multer';
import type { ErrorRequestHandler } from 'express';

import { logger } from '../config/logger.js';
import { AppError } from '../errors/app.error.js';

type JsonParseError = SyntaxError & {
  type?: string;
};

type PayloadTooLargeError = Error & {
  status?: number;
  type?: string;
};

export const errorMiddleware: ErrorRequestHandler = (error, req, res, _next): void => {
  if (error instanceof MulterError) {
    const isFileTooLarge = error.code === 'LIMIT_FILE_SIZE';
    const isUnexpectedFile = error.code === 'LIMIT_UNEXPECTED_FILE';

    const statusCode = isFileTooLarge ? 413 : 400;

    const code = isFileTooLarge
      ? 'AVATAR_TOO_LARGE'
      : isUnexpectedFile
        ? 'INVALID_AVATAR_FIELD'
        : error.code === 'LIMIT_FILE_COUNT'
          ? 'AVATAR_UPLOAD_LIMIT_EXCEEDED'
          : 'INVALID_AVATAR_UPLOAD';

    res.status(statusCode).json({
      success: false,
      error: {
        code,
        message: isFileTooLarge ? 'Avatar file exceeds the 5 MB limit' : 'Invalid avatar upload',
      },
    });

    return;
  }
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });

    return;
  }

  if (error instanceof SyntaxError && (error as JsonParseError).type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Invalid JSON payload',
      },
    });

    return;
  }

  if (
    error instanceof Error &&
    (error as PayloadTooLargeError).status === 413 &&
    (error as PayloadTooLargeError).type === 'entity.too.large'
  ) {
    res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      },
    });

    return;
  }

  logger.error(
    {
      err: error,
      method: req.method,
      path: req.originalUrl,
      requestId: res.getHeader('X-Request-Id'),
    },
    'Unhandled request error',
  );

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    },
  });
};
