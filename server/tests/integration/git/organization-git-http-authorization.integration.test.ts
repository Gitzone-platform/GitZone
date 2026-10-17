import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';
import prisma from '../../../src/config/prisma.js';
import { verifyPersonalAccessToken } from '../../../src/services/auth/pat.service.js';
import { lookupGitRepository } from '../../../src/services/git/git-repository-lookup.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repositoryTransfer: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    repository: { findUnique: vi.fn() },
    organizationMember: { findUnique: vi.fn() },
  },
}));

vi.mock('../../../src/services/git/git-repository-lookup.service.js', () => ({
  lookupGitRepository: vi.fn(),
}));

vi.mock('../../../src/services/auth/pat.service.js', () => ({
  verifyPersonalAccessToken: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();

  return { ...actual, spawn: vi.fn() };
});

const findRepository = vi.mocked(prisma.repository.findUnique);
const findMembership = vi.mocked(prisma.organizationMember.findUnique);
const mockedLookup = vi.mocked(lookupGitRepository);
const mockedPAT = vi.mocked(verifyPersonalAccessToken);
const mockedSpawn = vi.mocked(spawn);

const repository = {
  id: 'org-repo-1',
  name: 'platform',
  ownerId: 'shadow-owner',
  organizationId: 'org-1',
  organization: { id: 'org-1', slug: 'engineering' },
  isPrivate: true,
  collaborators: [] as { permission: 'READ' | 'WRITE' }[],
};

const lookupResult = {
  id: repository.id,
  name: repository.name,
  isPrivate: repository.isPrivate,
  defaultBranch: 'main',
  owner: {
    type: 'ORGANIZATION' as const,
    id: 'org-1',
    name: 'engineering',
  },
};

const authorizationHeader = `Basic ${Buffer.from('developer:valid-pat').toString('base64')}`;

const mockBackend = () => {
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
      child.stdout.end(Buffer.from('git-response'));
      child.emit('close', 0);
    });

    return child as never;
  });
};

describe('Organization Git HTTP authorization service integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findRepository.mockResolvedValue(repository as never);
    findMembership.mockResolvedValue(null);
    mockedLookup.mockResolvedValue(lookupResult);
    mockedPAT.mockResolvedValue({ userId: 'user-1', username: 'developer' });
    mockBackend();
  });

  it('allows OWNER push through real authorization service', async () => {
    findMembership.mockResolvedValue({ role: 'OWNER' } as never);

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-receive-pack')
      .set('Authorization', authorizationHeader);

    expect(response.status).toBe(200);
    expect(findMembership).toHaveBeenCalledOnce();
    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('denies MEMBER push through real authorization service', async () => {
    findMembership.mockResolvedValue({ role: 'MEMBER' } as never);

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-receive-pack')
      .set('Authorization', authorizationHeader);

    expect(response.status).toBe(403);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('allows WRITE collaborator push through real authorization service', async () => {
    findRepository.mockResolvedValue({
      ...repository,
      collaborators: [{ permission: 'WRITE' }],
    } as never);

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-receive-pack')
      .set('Authorization', authorizationHeader);

    expect(response.status).toBe(200);
    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('denies READ collaborator push through real authorization service', async () => {
    findRepository.mockResolvedValue({
      ...repository,
      collaborators: [{ permission: 'READ' }],
    } as never);

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-receive-pack')
      .set('Authorization', authorizationHeader);

    expect(response.status).toBe(403);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('denies shadow owner without membership or collaborator permission', async () => {
    mockedPAT.mockResolvedValue({
      userId: 'shadow-owner',
      username: 'shadow',
    });

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-receive-pack')
      .set('Authorization', authorizationHeader);

    expect(response.status).toBe(403);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('allows MEMBER to read private organization repository', async () => {
    findMembership.mockResolvedValue({ role: 'MEMBER' } as never);

    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-upload-pack')
      .set('Authorization', authorizationHeader);

    expect(response.status).toBe(200);
    expect(mockedSpawn).toHaveBeenCalledOnce();
  });

  it('denies outsider reading private organization repository', async () => {
    const response = await request(app)
      .get('/engineering/platform.git/info/refs?service=git-upload-pack')
      .set('Authorization', authorizationHeader);

    expect(response.status).toBe(403);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('allows anonymous reading public organization repository', async () => {
    findRepository.mockResolvedValue({
      ...repository,
      isPrivate: false,
      collaborators: false,
    } as never);

    mockedLookup.mockResolvedValue({
      ...lookupResult,
      isPrivate: false,
    });

    const response = await request(app).get(
      '/engineering/platform.git/info/refs?service=git-upload-pack',
    );

    expect(response.status).toBe(200);
    expect(findMembership).not.toHaveBeenCalled();
    expect(mockedSpawn).toHaveBeenCalledOnce();
  });
});