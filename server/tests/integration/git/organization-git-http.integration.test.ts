const transferGuardMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/repositories/repository-transfer-write-guard.service.js', () => ({
  assertRepositoryTransferAllowsGitWrite: transferGuardMock,
}));
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import { AppError } from '../../../src/errors/app.error.js';
import { verifyPersonalAccessToken } from '../../../src/services/auth/pat.service.js';
import { lookupGitRepository } from '../../../src/services/git/git-repository-lookup.service.js';
import { authorizeOrganizationRepositoryAccess } from '../../../src/services/repositories/organization-repository-authorization.service.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';

vi.mock('../../../src/services/git/git-repository-lookup.service.js', () => ({
  lookupGitRepository: vi.fn(),
}));

vi.mock('../../../src/services/auth/pat.service.js', () => ({
  verifyPersonalAccessToken: vi.fn(),
}));

vi.mock(
  '../../../src/services/repositories/organization-repository-authorization.service.js',
  () => ({
    authorizeOrganizationRepositoryAccess: vi.fn(),
  }),
);

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

const mockedLookup = vi.mocked(lookupGitRepository);
const mockedPAT = vi.mocked(verifyPersonalAccessToken);
const mockedOrganizationAuthorization = vi.mocked(authorizeOrganizationRepositoryAccess);
const mockedLegacyAuthorization = vi.mocked(authorizeRepositoryAccess);
const mockedSpawn = vi.mocked(spawn);

const organizationRepository = {
  id: 'org-repo-1',
  name: 'platform',
  isPrivate: false,
  defaultBranch: 'main',
  owner: {
    type: 'ORGANIZATION' as const,
    id: 'org-1',
    name: 'engineering',
  },
};

const authenticatedUser = {
  userId: 'user-1',
  username: 'developer',
};

const basicAuthorization = `Basic ${Buffer.from('developer:valid-pat').toString('base64')}`;

const grantAccess = (permission: 'OWNER' | 'MEMBER' | 'READ' | 'WRITE' | 'PUBLIC') => {
  mockedOrganizationAuthorization.mockResolvedValue({
    repositoryId: organizationRepository.id,
    repositoryName: organizationRepository.name,
    organizationId: organizationRepository.owner.id,
    organizationSlug: organizationRepository.owner.name,
    isPrivate: organizationRepository.isPrivate,
    permission,
  });
};

const mockSuccessfulBackend = () => {
  mockedSpawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: PassThrough;
    };

    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();

    setImmediate(() => {
      child.stdout.write(
        Buffer.from('Status: 200 OK\r\nContent-Type: application/octet-stream\r\n\r\n'),
      );
      child.stdout.write(Buffer.from('git-response'));
      child.stdout.end();
      child.emit('close', 0);
    });

    return child as never;
  });
};

describe('Organization Git HTTP integration', () => {
  beforeEach(() => {
    transferGuardMock.mockReset();
    transferGuardMock.mockResolvedValue(undefined);
  });

  beforeEach(() => {
    vi.resetAllMocks();

    mockedLookup.mockResolvedValue(organizationRepository);
    mockedPAT.mockResolvedValue(authenticatedUser);
    grantAccess('PUBLIC');
    mockSuccessfulBackend();
  });

  it('allows anonymous clone of a public organization repository', async () => {
    const response = await request(app).get(
      '/engineering/platform.git/info/refs?service=git-upload-pack',
    );

    expect(response.status).toBe(200);
    expect(mockedOrganizationAuthorization).toHaveBeenCalledWith('org-repo-1', 'READ', undefined);
    expect(mockedPAT).not.toHaveBeenCalled();
    expect(mockedLegacyAuthorization).not.toHaveBeenCalled();

    expect(mockedSpawn).toHaveBeenCalledOnce();

    const options = mockedSpawn.mock.calls[0]?.[2];
    expect(options?.env?.PATH_INFO).toBe('/.organizations/engineering/platform.git/info/refs');
    expect(options?.env?.REMOTE_USER).toBeUndefined();
  });

  it('requires authentication for private organization clone', async () => {
    mockedLookup.mockResolvedValue({
      ...organizationRepository,
      isPrivate: true,
    });

    const response = await request(app).get(
      '/engineering/platform.git/info/refs?service=git-upload-pack',
    );

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain('Basic');
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('allows authenticated private clone for a member', async () => {
    mockedLookup.mockResolvedValue({
      ...organizationRepository,
      isPrivate: true,
    });
    grantAccess('MEMBER');

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-upload-pack')
      .set('Authorization', basicAuthorization);

    expect(response.status).toBe(200);
    expect(mockedOrganizationAuthorization).toHaveBeenCalledWith('org-repo-1', 'READ', 'user-1');
    expect(mockedSpawn.mock.calls[0]?.[2]?.env?.REMOTE_USER).toBe('developer');
  });

  it('allows organization OWNER push', async () => {
    grantAccess('OWNER');

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-receive-pack')
      .set('Authorization', basicAuthorization);

    expect(response.status).toBe(200);
    expect(mockedOrganizationAuthorization).toHaveBeenCalledWith('org-repo-1', 'WRITE', 'user-1');
    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('allows WRITE collaborator push', async () => {
    grantAccess('WRITE');

    const response = await request(app)
      .post('/engineering/platform.git/git-receive-pack')
      .set('Authorization', basicAuthorization)
      .set('Content-Type', 'application/x-git-receive-pack-request')
      .send(Buffer.from('git-request'));

    expect(response.status).toBe(200);
    expect(mockedOrganizationAuthorization).toHaveBeenCalledWith('org-repo-1', 'WRITE', 'user-1');
    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('denies MEMBER push', async () => {
    mockedOrganizationAuthorization.mockRejectedValue(
      new AppError(
        'You do not have permission to access this organization repository',
        403,
        'ORGANIZATION_REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-receive-pack')
      .set('Authorization', basicAuthorization);

    expect(response.status).toBe(403);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('denies READ collaborator push', async () => {
    mockedOrganizationAuthorization.mockRejectedValue(
      new AppError(
        'You do not have permission to access this organization repository',
        403,
        'ORGANIZATION_REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .post('/engineering/platform.git/git-receive-pack')
      .set('Authorization', basicAuthorization)
      .set('Content-Type', 'application/x-git-receive-pack-request')
      .send(Buffer.from('git-request'));

    expect(response.status).toBe(403);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('denies shadow owner without organization permission', async () => {
    mockedPAT.mockResolvedValue({
      userId: 'shadow-owner',
      username: 'shadow',
    });

    mockedOrganizationAuthorization.mockRejectedValue(
      new AppError(
        'You do not have permission to access this organization repository',
        403,
        'ORGANIZATION_REPOSITORY_ACCESS_DENIED',
      ),
    );

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-receive-pack')
      .set('Authorization', `Basic ${Buffer.from('shadow:valid-pat').toString('base64')}`);

    expect(response.status).toBe(403);
    expect(mockedLegacyAuthorization).not.toHaveBeenCalled();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('rejects namespace identity changes between lookup and lock', async () => {
    mockedLookup.mockResolvedValueOnce(organizationRepository).mockResolvedValueOnce({
      ...organizationRepository,
      owner: {
        type: 'ORGANIZATION',
        id: 'org-2',
        name: 'engineering',
      },
    });

    const response = await request(app).get(
      '/engineering/platform.git/info/refs?service=git-upload-pack',
    );

    expect(response.status).toBe(404);
    expect(mockedOrganizationAuthorization).not.toHaveBeenCalled();
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('rejects mismatched organization authorization identity', async () => {
    mockedOrganizationAuthorization.mockResolvedValue({
      repositoryId: organizationRepository.id,
      repositoryName: organizationRepository.name,
      organizationId: 'another-organization',
      organizationSlug: organizationRepository.owner.name,
      isPrivate: false,
      permission: 'PUBLIC',
    });

    const response = await request(app).get(
      '/engineering/platform.git/info/refs?service=git-upload-pack',
    );

    expect(response.status).toBe(404);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });
  it('blocks organization push when transfer is active', async () => {
    const { AppError } = await import('../../../src/errors/app.error.js');

    transferGuardMock.mockRejectedValueOnce(
      new AppError(
        'Repository transfer is in progress',
        409,
        'GIT_REPOSITORY_TRANSFER_WRITE_BLOCKED',
      ),
    );

    const { authorizeOrganizationRepositoryAccess } =
      await import('../../../src/services/repositories/organization-repository-authorization.service.js');

    vi.mocked(authorizeOrganizationRepositoryAccess).mockResolvedValueOnce({
      repositoryId: 'org-repo-1',
      repositoryName: 'platform',
      organizationId: 'org-1',
      organizationSlug: 'engineering',
      isPrivate: true,
      permission: 'OWNER',
    });

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-receive-pack')
      .set('Authorization', basicAuthorization);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('GIT_REPOSITORY_TRANSFER_WRITE_BLOCKED');
    expect(transferGuardMock).toHaveBeenCalledWith('org-repo-1');
  });
});
