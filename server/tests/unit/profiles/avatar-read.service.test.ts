import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readStoredAvatar } from '../../../src/services/profiles/avatar-read.service.js';

vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(),
  open: vi.fn(),
}));

vi.mock('../../../src/services/profiles/avatar-upload.service.js', () => ({
  assertAvatarStorageIsolated: vi.fn(),
}));

const mockedLstat = vi.mocked(lstat);
const mockedOpen = vi.mocked(open);

const filename = '123e4567-e89b-42d3-a456-426614174000.webp';

const directoryStats = {
  isDirectory: () => true,
  isSymbolicLink: () => false,
};

const regularFileStats = {
  isFile: () => true,
  isSymbolicLink: () => false,
  size: 4,
};

const symlinkStats = {
  isDirectory: () => false,
  isFile: () => false,
  isSymbolicLink: () => true,
};

describe('avatar read storage security', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedLstat.mockResolvedValue(directoryStats as never);
  });

  it('rejects path traversal filenames', async () => {
    await expect(readStoredAvatar('../secret.webp')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_AVATAR_FILENAME',
    });

    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('rejects filenames without the expected UUID format', async () => {
    await expect(readStoredAvatar('avatar.webp')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_AVATAR_FILENAME',
    });

    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('rejects a symlink in the storage directory path', async () => {
    mockedLstat.mockResolvedValueOnce(symlinkStats as never);

    await expect(readStoredAvatar(filename)).rejects.toMatchObject({
      statusCode: 500,
      code: 'AVATAR_STORAGE_UNSAFE',
    });

    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('rejects a symlink avatar file', async () => {
    mockedLstat.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith(filename)) {
        return symlinkStats as never;
      }

      return directoryStats as never;
    });

    await expect(readStoredAvatar(filename)).rejects.toMatchObject({
      statusCode: 404,
      code: 'AVATAR_NOT_FOUND',
    });

    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing avatar file', async () => {
    mockedLstat.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith(filename)) {
        throw Object.assign(new Error('Not found'), {
          code: 'ENOENT',
        });
      }

      return directoryStats as never;
    });

    await expect(readStoredAvatar(filename)).rejects.toMatchObject({
      statusCode: 404,
      code: 'AVATAR_NOT_FOUND',
    });

    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('reads a valid stored avatar and closes its handle', async () => {
    const buffer = Buffer.from('RIFF');

    mockedLstat.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith(filename)) {
        return regularFileStats as never;
      }

      return directoryStats as never;
    });

    const close = vi.fn().mockResolvedValue(undefined);

    mockedOpen.mockResolvedValue({
      stat: vi.fn().mockResolvedValue(regularFileStats),
      readFile: vi.fn().mockResolvedValue(buffer),
      close,
    } as never);

    const result = await readStoredAvatar(filename);

    expect(result).toEqual(buffer);
    expect(mockedOpen).toHaveBeenCalledWith(
      expect.stringContaining(filename),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects oversized stored files and closes the handle', async () => {
    mockedLstat.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith(filename)) {
        return regularFileStats as never;
      }

      return directoryStats as never;
    });

    const close = vi.fn().mockResolvedValue(undefined);
    const readFile = vi.fn();

    mockedOpen.mockResolvedValue({
      stat: vi.fn().mockResolvedValue({
        isFile: () => true,
        size: 5 * 1024 * 1024 + 1,
      }),
      readFile,
      close,
    } as never);

    await expect(readStoredAvatar(filename)).rejects.toMatchObject({
      statusCode: 404,
      code: 'AVATAR_NOT_FOUND',
    });

    expect(readFile).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
