import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import {
  createIssue,
  getIssue,
  listIssues,
  updateIssue,
} from '../../../src/services/issues/issue.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: {
      findFirst: vi.fn(),
    },
    issue: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    repositoryIssueCounter: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const findRepository = vi.mocked(prisma.repository.findFirst);
const createRecord = vi.mocked(prisma.issue.create);
const findRecords = vi.mocked(prisma.issue.findMany);
const countRecords = vi.mocked(prisma.issue.count);
const findRecord = vi.mocked(prisma.issue.findUnique);
const updateRecord = vi.mocked(prisma.issue.update);
const upsertCounter = vi.mocked(prisma.repositoryIssueCounter.upsert);
const transaction = vi.mocked(prisma.$transaction);
const authorize = vi.mocked(authorizeRepositoryAccess);

describe('Issue service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findRepository.mockResolvedValue({ id: 'repo-1' } as never);
    authorize.mockResolvedValue(undefined as never);
  });

  it('rejects creating an issue when repository does not exist', async () => {
    findRepository.mockResolvedValue(null as never);

    await expect(createIssue('user-1', 'owner', 'demo', { title: 'Bug' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });
  });

  it('creates an issue with an atomic repository counter', async () => {
    upsertCounter.mockResolvedValue({ nextNumber: 5 } as never);

    createRecord.mockResolvedValue({
      id: 'issue-1',
      number: 4,
      title: 'Bug',
    } as never);

    transaction.mockImplementation((async (callback: unknown) => {
      if (typeof callback !== 'function') {
        throw new Error('Expected interactive transaction');
      }

      return callback({
        repositoryIssueCounter: {
          upsert: upsertCounter,
        },
        issue: {
          create: createRecord,
        },
      });
    }) as never);

    const result = await createIssue('user-1', 'owner', 'demo', {
      title: 'Bug',
    });

    expect(result.number).toBe(4);
    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');
    expect(upsertCounter).toHaveBeenCalledOnce();
    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          repositoryId: 'repo-1',
          number: 4,
          creatorId: 'user-1',
          title: 'Bug',
          body: null,
        }),
      }),
    );
  });

  it('lists issues with state filter and pagination', async () => {
    findRecords.mockResolvedValue([{ id: 'issue-1' }] as never);
    countRecords.mockResolvedValue(21 as never);

    transaction.mockResolvedValue([[{ id: 'issue-1' }], 21] as never);

    const result = await listIssues('owner', 'demo', 'user-1', {
      state: 'OPEN',
      page: 2,
      limit: 10,
    });

    expect(authorize).toHaveBeenCalledWith('repo-1', 'READ', 'user-1');
    expect(findRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId: 'repo-1',
          state: 'OPEN',
        },
        skip: 10,
        take: 10,
      }),
    );
    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
  });

  it('gets an issue by repository and number', async () => {
    findRecord.mockResolvedValue({
      id: 'issue-1',
      number: 7,
    } as never);

    const result = await getIssue('owner', 'demo', 7, 'user-1');

    expect(result.number).toBe(7);
    expect(findRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId_number: {
            repositoryId: 'repo-1',
            number: 7,
          },
        },
      }),
    );
  });

  it('returns 404 when issue does not exist', async () => {
    findRecord.mockResolvedValue(null as never);

    await expect(getIssue('owner', 'demo', 999, 'user-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_NOT_FOUND',
    });
  });

  it('updates issue title and body', async () => {
    findRecord.mockResolvedValue({ id: 'issue-1' } as never);
    updateRecord.mockResolvedValue({
      id: 'issue-1',
      title: 'Updated',
      body: 'New description',
    } as never);

    const result = await updateIssue('user-1', 'owner', 'demo', 1, {
      title: 'Updated',
      body: 'New description',
    });

    expect(result.title).toBe('Updated');
    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'issue-1' },
        data: {
          title: 'Updated',
          body: 'New description',
        },
      }),
    );
  });

  it('closes an issue and sets closedAt', async () => {
    findRecord.mockResolvedValue({ id: 'issue-1' } as never);
    updateRecord.mockResolvedValue({
      id: 'issue-1',
      state: 'CLOSED',
    } as never);

    await updateIssue('user-1', 'owner', 'demo', 1, {
      state: 'CLOSED',
    });

    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          state: 'CLOSED',
          closedAt: expect.any(Date),
        },
      }),
    );
  });

  it('reopens an issue and clears closedAt', async () => {
    findRecord.mockResolvedValue({ id: 'issue-1' } as never);
    updateRecord.mockResolvedValue({
      id: 'issue-1',
      state: 'OPEN',
    } as never);

    await updateIssue('user-1', 'owner', 'demo', 1, {
      state: 'OPEN',
    });

    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          state: 'OPEN',
          closedAt: null,
        },
      }),
    );
  });
});
