import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../../errors/app.error.js';
import { assertAvatarStorageIsolated } from './avatar-upload.service.js';

const AVATAR_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i;

const MAX_STORED_AVATAR_BYTES = 5 * 1024 * 1024;

const assertSafeAvatarDirectory = async (directory: string): Promise<void> => {
  const parsed = path.parse(directory);
  const segments = path.relative(parsed.root, directory).split(path.sep).filter(Boolean);

  let current = parsed.root;

  for (const segment of segments) {
    current = path.join(current, segment);

    let stats;

    try {
      stats = await lstat(current);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new AppError('Avatar not found', 404, 'AVATAR_NOT_FOUND');
      }

      throw error;
    }

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new AppError('Unsafe avatar storage directory', 500, 'AVATAR_STORAGE_UNSAFE');
    }
  }
};
export const readStoredAvatar = async (filename: string): Promise<Buffer> => {
  if (!AVATAR_FILENAME_PATTERN.test(filename)) {
    throw new AppError('Invalid avatar filename', 400, 'INVALID_AVATAR_FILENAME');
  }

  assertAvatarStorageIsolated();

  const directory = path.resolve(process.cwd(), 'storage', 'avatars');
  await assertSafeAvatarDirectory(directory);
  const absolutePath = path.join(directory, filename);

  const noFollow = constants.O_NOFOLLOW ?? 0;

  let file;
  let entry;

  try {
    entry = await lstat(absolutePath);

    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new AppError('Avatar not found', 404, 'AVATAR_NOT_FOUND');
    }
    file = await open(absolutePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ELOOP' || error.code === 'EACCES')
    ) {
      throw new AppError('Avatar not found', 404, 'AVATAR_NOT_FOUND');
    }

    throw error;
  }

  try {
    const stats = await file.stat();

    // Detect replacement between lstat() and open().
    // This is defense in depth, not a complete TOCTOU guarantee.
    if (
      !stats.isFile() ||
      stats.dev !== entry.dev ||
      stats.ino !== entry.ino ||
      stats.size <= 0 ||
      stats.size > MAX_STORED_AVATAR_BYTES
    ) {
      throw new AppError('Invalid stored avatar', 404, 'AVATAR_NOT_FOUND');
    }

    const buffer = await file.readFile();

    if (buffer.length !== stats.size) {
      throw new AppError('Invalid stored avatar', 404, 'AVATAR_NOT_FOUND');
    }

    return buffer;
  } finally {
    await file.close();
  }
};
