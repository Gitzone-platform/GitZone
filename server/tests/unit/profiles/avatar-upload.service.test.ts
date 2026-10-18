import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { processAndStoreAvatar } from '../../../src/services/profiles/avatar-upload.service.js';

describe('avatar upload security', () => {
  it('rejects an empty file', async () => {
    await expect(processAndStoreAvatar(Buffer.alloc(0), 'image/png')).rejects.toMatchObject({
      statusCode: 413,
      code: 'INVALID_AVATAR_SIZE',
    });
  });

  it('rejects files larger than 5 MB', async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);

    await expect(processAndStoreAvatar(oversized, 'image/png')).rejects.toMatchObject({
      statusCode: 413,
      code: 'INVALID_AVATAR_SIZE',
    });
  });

  it('rejects corrupted image data', async () => {
    const corrupted = Buffer.from('not-a-real-image');

    await expect(processAndStoreAvatar(corrupted, 'image/png')).rejects.toMatchObject({
      statusCode: 415,
      code: 'INVALID_AVATAR_IMAGE',
    });
  });

  it('rejects JPEG content declared as PNG', async () => {
    const jpeg = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: '#ffffff',
      },
    })
      .jpeg()
      .toBuffer();

    await expect(processAndStoreAvatar(jpeg, 'image/png')).rejects.toMatchObject({
      statusCode: 415,
      code: 'AVATAR_MIME_MISMATCH',
    });
  });

  it('rejects unsupported image formats', async () => {
    const gif = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: '#ffffff',
      },
    })
      .gif()
      .toBuffer();

    await expect(processAndStoreAvatar(gif, 'image/gif')).rejects.toMatchObject({
      statusCode: 415,
    });
  });

  it('rejects images exceeding the pixel limit', async () => {
    const hugeImage = await sharp({
      create: {
        width: 5000,
        height: 5000,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();

    await expect(processAndStoreAvatar(hugeImage, 'image/png')).rejects.toMatchObject({
      statusCode: 415,
      code: 'INVALID_AVATAR_IMAGE',
    });
  });
});
