import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { renameGitUserDirectory } from '../../../src/services/git/git-user-directory.service.js';
import { changeUsername } from '../../../src/services/profiles/username-change.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    namespaceEntry: {
      findUnique: vi.fn(),
    },
    repository: {
      count: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/git/git-user-directory.service.js', () => ({
  renameGitUserDirectory: vi.fn(),
}));

const findUnique = vi.mocked(prisma.user.findUnique);
const findFirst = vi.mocked(prisma.user.findFirst);
const update = vi.mocked(prisma.user.update);
const repositoryCount = vi.mocked(prisma.repository.count);
const namespaceFindUnique = vi.mocked(prisma.namespaceEntry.findUnique);
const renameDirectory = vi.mocked(renameGitUserDirectory);

describe('username change service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'olduser',
    } as never);

    findFirst.mockResolvedValue(null as never);
    namespaceFindUnique.mockResolvedValue(null as never);
    update.mockResolvedValue({ id: 'user-1' } as never);
    renameDirectory.mockResolvedValue(true);
    repositoryCount.mockResolvedValue(0);
  });

  it('renames Git storage and updates the database', async () => {
    await changeUsername('user-1', 'newuser');

    expect(renameDirectory).toHaveBeenCalledWith('olduser', 'newuser');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { username: 'newuser' },
      select: { id: true },
    });
  });

  it('updates username and profile fields in one database operation', async () => {
    await changeUsername('user-1', 'newuser', {
      name: 'New Name',
      bio: 'Full Stack Developer',
      location: 'Bukhara',
      website: 'https://example.com',
    });

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        username: 'newuser',
        name: 'New Name',
        bio: 'Full Stack Developer',
        location: 'Bukhara',
        website: 'https://example.com',
      },
      select: { id: true },
    });
  });

  it('preserves omitted fields and supports clearing profile fields', async () => {
    await changeUsername('user-1', 'newuser', {
      bio: null,
      website: null,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        username: 'newuser',
        bio: null,
        website: null,
      },
      select: { id: true },
    });
  });

  it('rolls back Git storage if combined profile update fails', async () => {
    update.mockRejectedValueOnce(new Error('Combined database update failed'));

    await expect(
      changeUsername('user-1', 'newuser', {
        name: 'New Name',
        location: 'Bukhara',
      }),
    ).rejects.toThrow('Combined database update failed');

    expect(update).toHaveBeenCalledOnce();

    expect(renameDirectory).toHaveBeenNthCalledWith(1, 'olduser', 'newuser');

    expect(renameDirectory).toHaveBeenNthCalledWith(2, 'newuser', 'olduser');
  });
  it('skips repository count when Git directory was moved', async () => {
    await changeUsername('user-1', 'newuser');

    expect(repositoryCount).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it('allows username change without a Git directory when there are no repositories', async () => {
    renameDirectory.mockResolvedValue(false);
    repositoryCount.mockResolvedValue(0);

    await changeUsername('user-1', 'newuser');

    expect(repositoryCount).toHaveBeenCalledWith({
      where: { ownerId: 'user-1' },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { username: 'newuser' },
      select: { id: true },
    });
  });

  it('rejects username change when Git directory is missing but repositories exist', async () => {
    renameDirectory.mockResolvedValue(false);
    repositoryCount.mockResolvedValue(1);

    await expect(changeUsername('user-1', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GIT_USER_DIRECTORY_MISSING',
    });

    expect(repositoryCount).toHaveBeenCalledWith({
      where: { ownerId: 'user-1' },
    });
    expect(update).not.toHaveBeenCalled();
  });
  it('does nothing when username is unchanged', async () => {
    await changeUsername('user-1', 'olduser');

    expect(findFirst).not.toHaveBeenCalled();
    expect(renameDirectory).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('updates profile fields without renaming Git storage when username is unchanged', async () => {
    await changeUsername('user-1', 'olduser', {
      name: 'Updated Name',
      bio: null,
    });

    expect(renameDirectory).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        name: 'Updated Name',
        bio: null,
      },
      select: { id: true },
    });
  });

  it('propagates database errors when updating fields with unchanged username', async () => {
    update.mockRejectedValueOnce(new Error('Database unavailable'));

    await expect(
      changeUsername('user-1', 'olduser', {
        location: 'Bukhara',
      }),
    ).rejects.toThrow('Database unavailable');

    expect(renameDirectory).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });
  it('rejects an invalid username', async () => {
    await expect(changeUsername('user-1', '../unsafe')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_USERNAME',
    });

    expect(renameDirectory).not.toHaveBeenCalled();
  });

  it('returns 404 when user does not exist', async () => {
    findUnique.mockResolvedValue(null as never);

    await expect(changeUsername('user-1', 'newuser')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('rejects case-only username changes', async () => {
    await expect(changeUsername('user-1', 'OldUser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'USERNAME_CASE_CONFLICT',
    });

    expect(renameDirectory).not.toHaveBeenCalled();
  });

  it('rejects a username already taken', async () => {
    findFirst.mockResolvedValue({ id: 'other-user' } as never);

    await expect(changeUsername('user-1', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'USERNAME_TAKEN',
    });

    expect(renameDirectory).not.toHaveBeenCalled();
  });

  it('rejects a reserved organization slug before moving Git storage', async () => {
    namespaceFindUnique.mockResolvedValue({
      name: 'newuser',
    } as never);

    await expect(changeUsername('user-1', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'USERNAME_TAKEN',
    });

    expect(namespaceFindUnique).toHaveBeenCalledWith({
      where: { name: 'newuser' },
      select: { name: true },
    });

    expect(renameDirectory).not.toHaveBeenCalled();
    expect(repositoryCount).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('does not move Git storage when namespace lookup fails', async () => {
    const databaseError = new Error('Namespace lookup failed');

    namespaceFindUnique.mockRejectedValueOnce(databaseError);

    await expect(changeUsername('user-1', 'newuser')).rejects.toBe(databaseError);

    expect(renameDirectory).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('does not update database when Git rename fails', async () => {
    renameDirectory.mockRejectedValueOnce(new Error('Filesystem rename failed'));

    await expect(changeUsername('user-1', 'newuser')).rejects.toThrow('Filesystem rename failed');

    expect(update).not.toHaveBeenCalled();
  });

  it('rolls back Git directory when database update fails', async () => {
    update.mockRejectedValueOnce(new Error('Database unavailable'));

    await expect(changeUsername('user-1', 'newuser')).rejects.toThrow('Database unavailable');

    expect(renameDirectory).toHaveBeenNthCalledWith(1, 'olduser', 'newuser');

    expect(renameDirectory).toHaveBeenNthCalledWith(2, 'newuser', 'olduser');
  });

  it('maps database unique constraint errors to 409', async () => {
    update.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      }),
    );

    await expect(changeUsername('user-1', 'newuser')).rejects.toMatchObject({
      statusCode: 409,
      code: 'USERNAME_TAKEN',
    });

    expect(renameDirectory).toHaveBeenCalledTimes(2);
  });

  it('updates database when user has no Git storage directory', async () => {
    renameDirectory.mockResolvedValueOnce(false);

    await changeUsername('user-1', 'newuser');

    expect(renameDirectory).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { username: 'newuser' },
      select: { id: true },
    });
  });

  it('reports rollback failure when directory restoration returns false', async () => {
    update.mockRejectedValueOnce(new Error('Database unavailable'));

    renameDirectory.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(changeUsername('user-1', 'newuser')).rejects.toMatchObject({
      statusCode: 500,
      code: 'USERNAME_ROLLBACK_FAILED',
    });

    expect(renameDirectory).toHaveBeenCalledTimes(2);
  });
  it('reports a failed Git directory rollback', async () => {
    update.mockRejectedValueOnce(new Error('Database unavailable'));

    renameDirectory.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('Rollback failed'));

    await expect(changeUsername('user-1', 'newuser')).rejects.toMatchObject({
      statusCode: 500,
      code: 'USERNAME_ROLLBACK_FAILED',
    });
  });
});
