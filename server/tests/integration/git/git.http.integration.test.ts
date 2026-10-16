import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';

import prisma from '../../../src/config/prisma.js';
import { env } from '../../../src/config/env.js';

import { AppError } from '../../../src/errors/app.error.js';
import { verifyPersonalAccessToken } from '../../../src/services/auth/pat.service.js';

import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import { withGitUserWriteLock } from '../../../src/services/git/git-user-lock.service.js';
import { lookupGitRepository } from '../../../src/services/git/git-repository-lookup.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/git/git-repository-lookup.service.js', () => ({
  lookupGitRepository: vi.fn(),
}));
vi.mock('../../../src/services/auth/pat.service.js', () => ({
  verifyPersonalAccessToken: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();

  return {
    ...actual,
    spawn: vi.fn(),
  };
});

const mockedFindRepository = vi.mocked(prisma.repository.findFirst);
const mockedFindRepositoryById = vi.mocked(prisma.repository.findUnique);

const mockedVerifyPersonalAccessToken = vi.mocked(verifyPersonalAccessToken);

const mockedAuthorizeRepositoryAccess = vi.mocked(authorizeRepositoryAccess);

const mockedSpawn = vi.mocked(spawn);
const mockedLookupGitRepository = vi.mocked(lookupGitRepository);

const gitRepository = {
  id: 'repo-1',
  name: 'demo',
  isPrivate: false,
  defaultBranch: 'main',
  owner: {
    id: 'owner-1',
    username: 'asil',
  },
};

const createGitBackendProcess = () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();

  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
  };

  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = stdin;

  return child;
};

const mockSuccessfulGitBackend = () => {
  mockedSpawn.mockImplementation(() => {
    const child = createGitBackendProcess();

    setImmediate(() => {
      const headers = [
        'Status: 200 OK',
        'Content-Type: application/x-git-upload-pack-advertisement',
        '',
        '',
      ].join('\r\n');

      child.stdout.write(Buffer.from(headers));
      child.stdout.write(Buffer.from('git-response'));
      child.stdout.end();

      child.emit('close', 0);
    });

    return child as never;
  });
};

describe('Git HTTP username locking', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedFindRepository.mockResolvedValue(gitRepository as never);
    mockedFindRepositoryById.mockResolvedValue(gitRepository as never);
    mockedLookupGitRepository.mockImplementation(async () => {
      const lookupNumber = mockedLookupGitRepository.mock.calls.length;
      const source =
        lookupNumber % 2 === 1
          ? await mockedFindRepository({} as never)
          : await mockedFindRepositoryById({} as never);

      if (!source) {
        throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
      }

      const legacyRepository = source as unknown as typeof gitRepository;

      return {
        id: legacyRepository.id,
        name: legacyRepository.name,
        isPrivate: legacyRepository.isPrivate,
        defaultBranch: legacyRepository.defaultBranch,
        owner: {
          type: 'USER',
          id: legacyRepository.owner.id,
          name: legacyRepository.owner.username,
        },
      };
    });
    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);
  });

  it('rejects an old username after repository recheck', async () => {
    mockedFindRepositoryById.mockResolvedValue({
      ...gitRepository,
      owner: {
        ...gitRepository.owner,
        username: 'renamed-user',
      },
    } as never);

    const response = await request(app)
      .get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_NOT_FOUND',
        message: 'Repository not found',
      },
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('keeps the user read lock until the Git backend closes', async () => {
    let releaseBackend!: () => void;
    let backendStarted!: () => void;

    const backendStartedPromise = new Promise<void>((resolve) => {
      backendStarted = resolve;
    });

    const backendGate = new Promise<void>((resolve) => {
      releaseBackend = resolve;
    });

    mockedSpawn.mockImplementation(() => {
      const child = createGitBackendProcess();

      backendStarted();

      void backendGate.then(() => {
        const headers = [
          'Status: 200 OK',
          'Content-Type: application/octet-stream',
          '',
          '',
        ].join('\r\n');

        child.stdout.write(Buffer.from(headers));
        child.stdout.end();
        child.emit('close', 0);
      });

      return child as never;
    });

    const responsePromise = request(app)
      .get('/asil/demo.git/info/refs?service=git-upload-pack')
      .then((response) => response);

    await backendStartedPromise;

    let writerStarted = false;

    const writerPromise = withGitUserWriteLock('owner-1', async () => {
      writerStarted = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(writerStarted).toBe(false);

    releaseBackend();

    const response = await responsePromise;
    await writerPromise;

    expect(response.status).toBe(200);
    expect(writerStarted).toBe(true);
  });

  it('rechecks repository state after a queued writer releases the lock', async () => {
    let releaseWriter!: () => void;
    let writerStarted!: () => void;

    const writerStartedPromise = new Promise<void>((resolve) => {
      writerStarted = resolve;
    });

    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });

    const writerPromise = withGitUserWriteLock('owner-1', async () => {
      writerStarted();
      await writerGate;
    });

    await writerStartedPromise;

    mockedFindRepositoryById.mockResolvedValue({
      ...gitRepository,
      owner: {
        ...gitRepository.owner,
        username: 'renamed-user',
      },
    } as never);

    const responsePromise = request(app)
      .get('/asil/demo.git/info/refs?service=git-upload-pack')
      .then((response) => response);

    await Promise.resolve();

    expect(mockedSpawn).not.toHaveBeenCalled();

    releaseWriter();

    await writerPromise;

    const response = await responsePromise;

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_NOT_FOUND',
        message: 'Repository not found',
      },
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });
});
describe('Git HTTP integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedFindRepositoryById.mockImplementation(() => {
      return mockedFindRepository.mock.results.at(-1)?.value ?? null;
    });

    mockedLookupGitRepository.mockImplementation(async () => {
      const lookupNumber = mockedLookupGitRepository.mock.calls.length;
      const source =
        lookupNumber % 2 === 1
          ? await mockedFindRepository({} as never)
          : await mockedFindRepositoryById({} as never);

      if (!source) {
        throw new AppError('Repository not found', 404, 'REPOSITORY_NOT_FOUND');
      }

      const legacyRepository = source as unknown as typeof gitRepository;

      return {
        id: legacyRepository.id,
        name: legacyRepository.name,
        isPrivate: legacyRepository.isPrivate,
        defaultBranch: legacyRepository.defaultBranch,
        owner: {
          type: 'USER',
          id: legacyRepository.owner.id,
          name: legacyRepository.owner.username,
        },
      };
    });
  });

  it('allows anonymous read access to a public repository', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockSuccessfulGitBackend();

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(200);

    expect(mockedVerifyPersonalAccessToken).not.toHaveBeenCalled();

    expect(mockedAuthorizeRepositoryAccess).toHaveBeenCalledWith('repo-1', 'READ', undefined);

    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('requires authentication for private repository read access', async () => {
    mockedFindRepository.mockResolvedValue({
      ...gitRepository,
      isPrivate: true,
    } as never);

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(401);

    expect(response.body).toMatchObject({
      success: false,
      code: 'GIT_AUTH_REQUIRED',
      message: 'Git username and personal access token are required',
    });

    expect(response.headers['www-authenticate']).toBe('Basic realm="GitZone"');

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('allows authenticated read access to a private repository', async () => {
    mockedFindRepository.mockResolvedValue({
      ...gitRepository,
      isPrivate: true,
    } as never);

    mockedVerifyPersonalAccessToken.mockResolvedValue({
      userId: 'user-2',
      username: 'testuser',
    });

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'READ',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockSuccessfulGitBackend();

    const credentials = Buffer.from('testuser:gzp_testtoken').toString('base64');

    const response = await request(app)
      .get('/asil/demo.git/info/refs?service=git-upload-pack')
      .set('Authorization', `Basic ${credentials}`);

    expect(response.status).toBe(200);

    expect(mockedVerifyPersonalAccessToken).toHaveBeenCalledWith('testuser', 'gzp_testtoken');

    expect(mockedAuthorizeRepositoryAccess).toHaveBeenCalledWith('repo-1', 'READ', 'user-2');

    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('requires authentication for repository write access', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-receive-pack');

    expect(response.status).toBe(401);

    expect(response.body).toMatchObject({
      success: false,
      code: 'GIT_AUTH_REQUIRED',
      message: 'Git username and personal access token are required',
    });

    expect(response.headers['www-authenticate']).toBe('Basic realm="GitZone"');

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('allows write access when authorization succeeds', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedVerifyPersonalAccessToken.mockResolvedValue({
      userId: 'user-2',
      username: 'testuser',
    });

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'WRITE',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockSuccessfulGitBackend();

    const credentials = Buffer.from('testuser:gzp_testtoken').toString('base64');

    const response = await request(app)
      .get('/asil/demo.git/info/refs?service=git-receive-pack')
      .set('Authorization', `Basic ${credentials}`);

    expect(response.status).toBe(200);

    expect(mockedVerifyPersonalAccessToken).toHaveBeenCalledWith('testuser', 'gzp_testtoken');

    expect(mockedAuthorizeRepositoryAccess).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-2');

    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('rejects write access when repository authorization fails', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedVerifyPersonalAccessToken.mockResolvedValue({
      userId: 'user-2',
      username: 'testuser',
    });

    mockedAuthorizeRepositoryAccess.mockRejectedValue(
      new AppError('Repository access denied', 403, 'REPOSITORY_ACCESS_DENIED'),
    );

    const credentials = Buffer.from('testuser:gzp_testtoken').toString('base64');

    const response = await request(app)
      .get('/asil/demo.git/info/refs?service=git-receive-pack')
      .set('Authorization', `Basic ${credentials}`);

    expect(response.status).toBe(403);

    expect(response.body).toMatchObject({
      success: false,
      code: 'REPOSITORY_ACCESS_DENIED',
      message: 'Repository access denied',
    });

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('returns 404 when repository does not exist', async () => {
    mockedFindRepository.mockResolvedValue(null);

    const response = await request(app).get('/asil/missing.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(404);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'REPOSITORY_NOT_FOUND',
        message: 'Repository not found',
      },
    });

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('passes correct CGI environment to git-http-backend', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockSuccessfulGitBackend();

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(200);

    expect(mockedSpawn).toHaveBeenCalledWith(
      env.GIT_HTTP_BACKEND_PATH,
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: '/asil/demo.git/info/refs',
          REQUEST_METHOD: 'GET',
          QUERY_STRING: 'service=git-upload-pack',
        }),
      }),
    );
  });

  it('rejects malformed basic authentication credentials', async () => {
    mockedFindRepository.mockResolvedValue({
      ...gitRepository,
      isPrivate: true,
    } as never);

    const malformedCredentials = Buffer.from('testuser').toString('base64');

    const response = await request(app)
      .get('/asil/demo.git/info/refs?service=git-upload-pack')
      .set('Authorization', `Basic ${malformedCredentials}`);

    expect(response.status).toBe(401);

    expect(response.body).toMatchObject({
      success: false,
      code: 'GIT_AUTH_REQUIRED',
      message: 'Git username and personal access token are required',
    });

    expect(response.headers['www-authenticate']).toBe('Basic realm="GitZone"');

    expect(mockedVerifyPersonalAccessToken).not.toHaveBeenCalled();

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('rejects an invalid personal access token', async () => {
    mockedFindRepository.mockResolvedValue({
      ...gitRepository,
      isPrivate: true,
    } as never);

    mockedVerifyPersonalAccessToken.mockRejectedValue(
      new AppError('Invalid personal access token', 401, 'INVALID_PERSONAL_ACCESS_TOKEN'),
    );

    const credentials = Buffer.from('testuser:gzp_invalidtoken').toString('base64');

    const response = await request(app)
      .get('/asil/demo.git/info/refs?service=git-upload-pack')
      .set('Authorization', `Basic ${credentials}`);

    expect(response.status).toBe(401);

    expect(response.body).toMatchObject({
      success: false,
      code: 'INVALID_PERSONAL_ACCESS_TOKEN',
      message: 'Invalid personal access token',
    });

    expect(response.headers['www-authenticate']).toBe('Basic realm="GitZone"');

    expect(mockedVerifyPersonalAccessToken).toHaveBeenCalledWith('testuser', 'gzp_invalidtoken');

    expect(mockedAuthorizeRepositoryAccess).not.toHaveBeenCalled();

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('handles git-upload-pack POST as a read request', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockSuccessfulGitBackend();

    const response = await request(app)
      .post('/asil/demo.git/git-upload-pack')
      .set('Content-Type', 'application/x-git-upload-pack-request')
      .send(Buffer.from('git-upload-request'));

    expect(response.status).toBe(200);

    expect(mockedVerifyPersonalAccessToken).not.toHaveBeenCalled();

    expect(mockedAuthorizeRepositoryAccess).toHaveBeenCalledWith('repo-1', 'READ', undefined);

    expect(mockedSpawn).toHaveBeenCalledWith(
      env.GIT_HTTP_BACKEND_PATH,
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH_INFO: '/asil/demo.git/git-upload-pack',
          REQUEST_METHOD: 'POST',
        }),
      }),
    );
  });

  it('handles git-receive-pack POST as a write request', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedVerifyPersonalAccessToken.mockResolvedValue({
      userId: 'user-2',
      username: 'testuser',
    });

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'WRITE',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockSuccessfulGitBackend();

    const credentials = Buffer.from('testuser:gzp_testtoken').toString('base64');

    const response = await request(app)
      .post('/asil/demo.git/git-receive-pack')
      .set('Authorization', `Basic ${credentials}`)
      .set('Content-Type', 'application/x-git-receive-pack-request')
      .send(Buffer.from('git-receive-request'));

    expect(response.status).toBe(200);

    expect(mockedVerifyPersonalAccessToken).toHaveBeenCalledWith('testuser', 'gzp_testtoken');

    expect(mockedAuthorizeRepositoryAccess).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-2');

    expect(mockedSpawn).toHaveBeenCalledWith(
      env.GIT_HTTP_BACKEND_PATH,
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH_INFO: '/asil/demo.git/git-receive-pack',
          REQUEST_METHOD: 'POST',
        }),
      }),
    );
  });

  it('uses the status returned by git-http-backend CGI headers', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockedSpawn.mockImplementation(() => {
      const child = createGitBackendProcess();

      setImmediate(() => {
        const headers = [
          'Status: 201 Created',
          'Content-Type: application/octet-stream',
          '',
          '',
        ].join('\r\n');

        child.stdout.write(Buffer.from(headers));
        child.stdout.write(Buffer.from('created'));
        child.stdout.end();

        child.emit('close', 0);
      });

      return child as never;
    });

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(201);

    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('preserves binary response data from git-http-backend', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    const binaryData = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]);

    mockedSpawn.mockImplementation(() => {
      const child = createGitBackendProcess();

      setImmediate(() => {
        const headers = ['Status: 200 OK', 'Content-Type: application/octet-stream', '', ''].join(
          '\r\n',
        );

        child.stdout.write(Buffer.from(headers));
        child.stdout.write(binaryData);
        child.stdout.end();

        child.emit('close', 0);
      });

      return child as never;
    });

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(200);

    expect(Buffer.isBuffer(response.body)).toBe(true);

    expect(Buffer.compare(response.body as Buffer, binaryData)).toBe(0);
  });

  it('returns 500 when git-http-backend process emits an error', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockedSpawn.mockImplementation(() => {
      const child = createGitBackendProcess();

      setImmediate(() => {
        child.emit('error', new Error('Unable to start git-http-backend'));
        child.stdout.end();
        child.stderr.end();
        child.emit('close', -2);
      });

      return child as never;
    });

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(500);

    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('returns 500 when git-http-backend exits with a non-zero code before sending headers', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockedSpawn.mockImplementation(() => {
      const child = createGitBackendProcess();

      setImmediate(() => {
        child.stdout.end();

        child.emit('close', 1);
      });

      return child as never;
    });

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(500);

    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('rejects unsupported Git HTTP paths before spawning the backend', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    const response = await request(app).get('/asil/demo.git/HEAD');

    expect(response.status).toBe(400);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_GIT_HTTP_PATH',
        message: 'Invalid Git HTTP path',
      },
    });

    expect(mockedVerifyPersonalAccessToken).not.toHaveBeenCalled();
    expect(mockedAuthorizeRepositoryAccess).not.toHaveBeenCalled();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('rejects oversized CGI headers from git-http-backend', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockedSpawn.mockImplementation(() => {
      const child = createGitBackendProcess();

      Object.assign(child, {
        killed: false,

        kill: vi.fn(function (this: { killed: boolean }) {
          this.killed = true;

          setImmediate(() => {
            child.stdout.end();
            child.stderr.end();
            child.emit('close', null);
          });

          return true;
        }),
      });

      setImmediate(() => {
        child.stdout.write(Buffer.alloc(20_000, 0x61));
      });

      return child as never;
    });

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(502);

    expect(response.body).toMatchObject({
      success: false,

      error: {
        code: 'GIT_HTTP_BACKEND_INVALID_RESPONSE',
      },
    });
  });

  it('does not leak server secrets into git-http-backend environment', async () => {
    mockedFindRepository.mockResolvedValue(gitRepository as never);

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'PUBLIC',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockSuccessfulGitBackend();

    const response = await request(app).get('/asil/demo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(200);

    const spawnOptions = mockedSpawn.mock.calls[0]?.[2];

    const childEnvironment = spawnOptions?.env;

    expect(childEnvironment).toMatchObject({
      PATH: env.GIT_CHILD_PATH,
      LANG: 'C',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: '/asil/demo.git/info/refs',
      REQUEST_METHOD: 'GET',
      QUERY_STRING: 'service=git-upload-pack',
    });

    expect(childEnvironment).not.toHaveProperty('DATABASE_URL');

    expect(childEnvironment).not.toHaveProperty('JWT_ACCESS_SECRET');

    expect(childEnvironment).not.toHaveProperty('JWT_REFRESH_SECRET');

    expect(childEnvironment).not.toHaveProperty('TWO_FACTOR_ENCRYPTION_KEY');

    expect(childEnvironment).not.toHaveProperty('OWNER_ACCESS_TOKEN');

    expect(childEnvironment).not.toHaveProperty('REMOTE_USER');
  });

  it('passes authenticated Git user as REMOTE_USER without leaking secrets', async () => {
    mockedFindRepository.mockResolvedValue({
      ...gitRepository,
      isPrivate: true,
    } as never);

    mockedVerifyPersonalAccessToken.mockResolvedValue({
      userId: 'user-2',
      username: 'testuser',
    });

    mockedAuthorizeRepositoryAccess.mockResolvedValue({
      permission: 'READ',
      repositoryId: 'repo-1',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'asil',
    } as never);

    mockSuccessfulGitBackend();

    const credentials = Buffer.from('testuser:gzp_testtoken').toString('base64');

    const response = await request(app)
      .get('/asil/demo.git/info/refs?service=git-upload-pack')
      .set('Authorization', `Basic ${credentials}`);

    expect(response.status).toBe(200);

    const childEnvironment = mockedSpawn.mock.calls[0]?.[2]?.env;

    expect(childEnvironment).toMatchObject({
      REMOTE_USER: 'testuser',
    });

    expect(childEnvironment).not.toHaveProperty('JWT_ACCESS_SECRET');

    expect(childEnvironment).not.toHaveProperty('DATABASE_URL');
  });
});
