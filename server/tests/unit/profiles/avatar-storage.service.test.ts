import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertAvatarStorageIsolated,
  processAndStoreAvatar,
} from '../../../src/services/profiles/avatar-upload.service.js';
import { readStoredAvatar } from '../../../src/services/profiles/avatar-read.service.js';

describe('avatar storage with real image processing', () => {
  let temporaryRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'gitzone-avatar-test-'));

    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(temporaryRoot);
  });

  afterEach(async () => {
    cwdSpy.mockRestore();

    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  it.each([
    ['JPEG', 'jpeg', 'image/jpeg'],
    ['PNG', 'png', 'image/png'],
    ['WebP', 'webp', 'image/webp'],
  ])('accepts a real %s image and stores WebP', async (_label, format, mimeType) => {
    const input = sharp({
      create: {
        width: 900,
        height: 600,
        channels: 3,
        background: '#2563eb',
      },
    });

    const buffer = await input.toFormat(format as 'jpeg' | 'png' | 'webp').toBuffer();

    const stored = await processAndStoreAvatar(buffer, mimeType);

    expect(stored.filename).toMatch(/^[0-9a-f-]{36}\.webp$/);

    expect(stored.avatarUrl).toBe(`/api/users/avatars/${stored.filename}`);

    expect(stored.absolutePath).toBe(
      path.join(temporaryRoot, 'storage', 'avatars', stored.filename),
    );

    const savedBuffer = await readFile(stored.absolutePath);
    const metadata = await sharp(savedBuffer).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBeLessThanOrEqual(512);
    expect(metadata.height).toBeLessThanOrEqual(512);
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);

    const fileStats = await stat(stored.absolutePath);

    expect(fileStats.isFile()).toBe(true);
    expect(fileStats.size).toBeGreaterThan(0);
  });

  it('preserves aspect ratio when resizing', async () => {
    const buffer = await sharp({
      create: {
        width: 1200,
        height: 600,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    const stored = await processAndStoreAvatar(buffer, 'image/png');

    const metadata = await sharp(await readFile(stored.absolutePath)).metadata();

    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(256);
  });

  it('does not enlarge small images', async () => {
    const buffer = await sharp({
      create: {
        width: 80,
        height: 60,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    const stored = await processAndStoreAvatar(buffer, 'image/png');

    const metadata = await sharp(await readFile(stored.absolutePath)).metadata();

    expect(metadata.width).toBe(80);
    expect(metadata.height).toBe(60);
  });

  it('stores and reads an avatar using the real filesystem', async () => {
    const input = await sharp({
      create: {
        width: 320,
        height: 240,
        channels: 3,
        background: '#2563eb',
      },
    })
      .png()
      .toBuffer();

    const stored = await processAndStoreAvatar(input, 'image/png');

    const result = await readStoredAvatar(stored.filename);

    const expected = await readFile(stored.absolutePath);

    expect(result.equals(expected)).toBe(true);

    const metadata = await sharp(result).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
  });
  it('rejects a symlinked avatar storage directory', async () => {
    const storageRoot = path.join(temporaryRoot, 'storage');
    const externalRoot = path.join(temporaryRoot, 'external-avatars');

    await mkdir(storageRoot);
    await mkdir(externalRoot);

    await symlink(
      externalRoot,
      path.join(storageRoot, 'avatars'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const input = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: '#2563eb',
      },
    })
      .png()
      .toBuffer();

    await expect(processAndStoreAvatar(input, 'image/png')).rejects.toMatchObject({
      code: 'AVATAR_STORAGE_UNSAFE',
    });

    expect(
      await readFile(path.join(externalRoot, 'sentinel.txt')).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return null;
        }

        throw error;
      }),
    ).toBeNull();
  });

  it('rejects reading through a symlinked avatar directory', async () => {
    const storageRoot = path.join(temporaryRoot, 'storage');
    const externalRoot = path.join(temporaryRoot, 'external-avatars');

    await mkdir(storageRoot);
    await mkdir(externalRoot);

    await symlink(
      externalRoot,
      path.join(storageRoot, 'avatars'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      readStoredAvatar('123e4567-e89b-42d3-a456-426614174000.webp'),
    ).rejects.toMatchObject({
      code: 'AVATAR_STORAGE_UNSAFE',
    });
  });

  it('keeps avatar storage isolated from Git repository storage', () => {
    expect(() => assertAvatarStorageIsolated()).not.toThrow();
  });
  it('generates unique filenames for separate uploads', async () => {
    const buffer = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    const first = await processAndStoreAvatar(buffer, 'image/png');
    const second = await processAndStoreAvatar(buffer, 'image/png');

    expect(first.filename).not.toBe(second.filename);

    expect((await stat(first.absolutePath)).isFile()).toBe(true);
    expect((await stat(second.absolutePath)).isFile()).toBe(true);
  });
});
