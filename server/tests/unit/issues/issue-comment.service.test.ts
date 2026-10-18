import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';
import {
  createIssueComment,
  listIssueComments,
  updateIssueComment,
  deleteIssueComment,
} from '../../../src/services/issues/issue-comment.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    repository: { findFirst: vi.fn() },
    issue: { findUnique: vi.fn() },
    issueComment: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

const findRepository = vi.mocked(prisma.repository.findFirst);
const findIssue = vi.mocked(prisma.issue.findUnique);
const createComment = vi.mocked(prisma.issueComment.create);
const findComments = vi.mocked(prisma.issueComment.findMany);
const countComments = vi.mocked(prisma.issueComment.count);
const findComment = vi.mocked(prisma.issueComment.findFirst);
const updateComment = vi.mocked(prisma.issueComment.update);
const deleteComment = vi.mocked(prisma.issueComment.delete);
const transaction = vi.mocked(prisma.$transaction);
const authorize = vi.mocked(authorizeRepositoryAccess);

describe('Issue comment service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    findRepository.mockResolvedValue({
      id: 'repo-1',
      ownerId: 'owner-1',
    } as never);

    findIssue.mockResolvedValue({ id: 'issue-1' } as never);
    authorize.mockResolvedValue(undefined as never);
  });

  it('rejects missing repository', async () => {
    findRepository.mockResolvedValue(null as never);

    await expect(
      createIssueComment('user-1', 'owner', 'demo', 1, { body: 'Hello' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPOSITORY_NOT_FOUND',
    });

    expect(createComment).not.toHaveBeenCalled();
  });

  it('rejects missing issue', async () => {
    findIssue.mockResolvedValue(null as never);

    await expect(
      createIssueComment('user-1', 'owner', 'demo', 999, { body: 'Hello' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_NOT_FOUND',
    });
  });

  it('creates comment with WRITE access', async () => {
    createComment.mockResolvedValue({
      id: 'comment-1',
      body: 'Hello',
    } as never);

    const result = await createIssueComment('user-1', 'owner', 'demo', 1, { body: 'Hello' });

    expect(result.body).toBe('Hello');
    expect(authorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'user-1');
    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          issueId: 'issue-1',
          authorId: 'user-1',
          body: 'Hello',
        },
      }),
    );
  });

  it('rejects comment creation when WRITE access is denied', async () => {
    authorize.mockRejectedValue({
      statusCode: 403,
      code: 'REPOSITORY_FORBIDDEN',
    });

    await expect(
      createIssueComment('reader-1', 'owner', 'demo', 1, { body: 'Hello' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_FORBIDDEN',
    });

    expect(createComment).not.toHaveBeenCalled();
  });

  it('lists comments with READ access and pagination', async () => {
    findComments.mockResolvedValue([{ id: 'comment-1' }] as never);
    countComments.mockResolvedValue(11 as never);

    transaction.mockResolvedValue([[{ id: 'comment-1' }], 11] as never);

    const result = await listIssueComments('owner', 'demo', 1, 'reader-1', { page: 2, limit: 5 });

    expect(authorize).toHaveBeenCalledWith('repo-1', 'READ', 'reader-1');
    expect(findComments).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId: 'issue-1' },
        skip: 5,
        take: 5,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );

    expect(result.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 11,
      totalPages: 3,
    });
  });

  it('allows comment author to update their comment', async () => {
    findComment.mockResolvedValue({
      id: 'comment-1',
      authorId: 'author-1',
    } as never);

    updateComment.mockResolvedValue({
      id: 'comment-1',
      body: 'Updated',
    } as never);

    const result = await updateIssueComment('author-1', 'owner', 'demo', 1, 'comment-1', {
      body: 'Updated',
    });

    expect(result.body).toBe('Updated');
    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'comment-1' },
        data: { body: 'Updated' },
      }),
    );
  });

  it('allows repository owner to update another user comment', async () => {
    findComment.mockResolvedValue({
      id: 'comment-1',
      authorId: 'author-1',
    } as never);

    updateComment.mockResolvedValue({
      id: 'comment-1',
      body: 'Owner edit',
    } as never);

    await updateIssueComment('owner-1', 'owner', 'demo', 1, 'comment-1', { body: 'Owner edit' });

    expect(updateComment).toHaveBeenCalledOnce();
  });

  it('rejects update by non-author and non-owner', async () => {
    findComment.mockResolvedValue({
      id: 'comment-1',
      authorId: 'author-1',
    } as never);

    await expect(
      updateIssueComment('reader-1', 'owner', 'demo', 1, 'comment-1', { body: 'Unauthorized' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'ISSUE_COMMENT_ACCESS_DENIED',
    });

    expect(updateComment).not.toHaveBeenCalled();
  });

  it('rejects updating a missing comment', async () => {
    findComment.mockResolvedValue(null as never);

    await expect(
      updateIssueComment('owner-1', 'owner', 'demo', 1, 'missing-comment', { body: 'Updated' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ISSUE_COMMENT_NOT_FOUND',
    });
  });

  it('allows comment author to delete their comment', async () => {
    findComment.mockResolvedValue({
      id: 'comment-1',
      authorId: 'author-1',
    } as never);

    deleteComment.mockResolvedValue({ id: 'comment-1' } as never);

    await deleteIssueComment('author-1', 'owner', 'demo', 1, 'comment-1');

    expect(deleteComment).toHaveBeenCalledWith({
      where: { id: 'comment-1' },
    });
  });
});
