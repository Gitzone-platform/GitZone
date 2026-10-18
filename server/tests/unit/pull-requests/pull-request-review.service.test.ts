import { beforeEach, describe, expect, it, vi } from 'vitest';

import prisma from '../../../src/config/prisma.js';

import { getGitRepositoryRefs } from '../../../src/services/git/git-ref.service.js';
import { validatePullRequestDiffAnchor } from '../../../src/services/pull-requests/pull-request-review-git.service.js';
import { authorizeRepositoryAccess } from '../../../src/services/repositories/repository-authorization.service.js';

vi.mock('../../../src/config/prisma.js', () => ({
  default: {
    pullRequest: {
      findFirst: vi.fn(),
    },
    pullRequestReview: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    pullRequestConversation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    pullRequestReviewComment: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../src/services/git/git-ref.service.js', () => ({
  getGitRepositoryRefs: vi.fn(),
}));

vi.mock('../../../src/services/repositories/repository-authorization.service.js', () => ({
  authorizeRepositoryAccess: vi.fn(),
}));

vi.mock('../../../src/services/pull-requests/pull-request-review-git.service.js', () => ({
  validatePullRequestDiffAnchor: vi.fn(),
}));

const mockedAuthorize = vi.mocked(authorizeRepositoryAccess);
const mockedRefs = vi.mocked(getGitRepositoryRefs);
const mockedValidateAnchor = vi.mocked(validatePullRequestDiffAnchor);

const mockedPullRequestFindFirst = vi.mocked(prisma.pullRequest.findFirst);
const mockedReviewCreate = vi.mocked(prisma.pullRequestReview.create);
const mockedReviewFindMany = vi.mocked(prisma.pullRequestReview.findMany);
const mockedConversationFindMany = vi.mocked(prisma.pullRequestConversation.findMany);
const mockedConversationFindFirst = vi.mocked(prisma.pullRequestConversation.findFirst);
const mockedConversationUpdateMany = vi.mocked(prisma.pullRequestConversation.updateMany);
const mockedConversationFindUniqueOrThrow = vi.mocked(
  prisma.pullRequestConversation.findUniqueOrThrow,
);
const mockedCommentCreate = vi.mocked(prisma.pullRequestReviewComment.create);
const mockedCommentFindFirst = vi.mocked(prisma.pullRequestReviewComment.findFirst);
const mockedCommentUpdate = vi.mocked(prisma.pullRequestReviewComment.update);
const mockedTransaction = vi.mocked(prisma.$transaction);

const BASE_SHA = '1111111111111111111111111111111111111111';
const HEAD_SHA = '2222222222222222222222222222222222222222';

const pullRequest = {
  id: 'pr-1',
  repositoryId: 'repo-1',
  milestoneId: null,
  number: 1,
  authorId: 'author-1',
  title: 'Feature PR',
  description: null,
  sourceBranch: 'feature',
  targetBranch: 'main',
  state: 'OPEN' as const,
  mergedAt: null,
  mergedById: null,
  mergeSha: null,
  createdAt: new Date('2026-10-07T10:00:00Z'),
  updatedAt: new Date('2026-10-07T10:00:00Z'),
  repository: {
    id: 'repo-1',
    name: 'demo',
    ownerId: 'owner-1',
  },
  author: {
    id: 'author-1',
    username: 'author',
    name: 'Author',
    avatarUrl: null,
  },
};

const refs = {
  objectFormat: 'sha1' as const,
  symbolicHead: 'refs/heads/main',
  defaultBranch: 'main',
  head: {
    name: 'main',
    fullName: 'refs/heads/main',
    oid: BASE_SHA,
    objectType: 'commit' as const,
  },
  branches: [
    {
      name: 'main',
      fullName: 'refs/heads/main',
      oid: BASE_SHA,
      objectType: 'commit' as const,
    },
    {
      name: 'feature',
      fullName: 'refs/heads/feature',
      oid: HEAD_SHA,
      objectType: 'commit' as const,
    },
  ],
  tags: [],
};

const review = {
  id: 'review-1',
  pullRequestId: 'pr-1',
  reviewerId: 'reviewer-1',
  state: 'APPROVED' as const,
  body: null,
  headSha: HEAD_SHA,
  createdAt: new Date('2026-10-07T10:00:00Z'),
  updatedAt: new Date('2026-10-07T10:00:00Z'),
  reviewer: {
    id: 'reviewer-1',
    username: 'reviewer',
    name: 'Reviewer',
    avatarUrl: null,
  },
};

const conversation = {
  id: 'conversation-1',
  pullRequestId: 'pr-1',
  type: 'GENERAL' as const,
  path: null,
  line: null,
  side: null,
  baseSha: null,
  headSha: null,
  resolvedAt: null,
  resolvedById: null,
  createdAt: new Date('2026-10-07T10:00:00Z'),
  updatedAt: new Date('2026-10-07T10:00:00Z'),
};

const {
  createGeneralPullRequestComment,
  createInlinePullRequestComment,
  createPullRequestConversationComment,
  deletePullRequestReviewComment,
  getPullRequestReviewState,
  listPullRequestConversationsWithOutdatedState,
  reopenPullRequestConversation,
  resolvePullRequestConversation,
  submitPullRequestReview,
  updatePullRequestReviewComment,
} = await import('../../../src/services/pull-requests/pull-request-review.service.js');

describe('pull request review service', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedPullRequestFindFirst.mockResolvedValue(pullRequest);
    mockedRefs.mockResolvedValue(refs);

    mockedAuthorize.mockResolvedValue({
      repositoryId: 'repo-1',
      repositoryName: 'demo',
      repositoryOwnerId: 'owner-1',
      repositoryOwnerUsername: 'owner',
      isPrivate: false,
      permission: 'WRITE',
    });

    mockedReviewCreate.mockResolvedValue(review);

    mockedValidateAnchor.mockResolvedValue({
      path: 'src/demo.ts',
      line: 2,
      side: 'RIGHT',
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
    });
  });

  it('requires WRITE access for approval', async () => {
    await submitPullRequestReview('reviewer-1', 'asil', 'demo', 1, {
      state: 'APPROVED',
    });

    expect(mockedAuthorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'reviewer-1');

    expect(mockedReviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewerId: 'reviewer-1',
          state: 'APPROVED',
          headSha: HEAD_SHA,
        }),
      }),
    );
  });

  it('requires WRITE access for request changes', async () => {
    await submitPullRequestReview('reviewer-1', 'asil', 'demo', 1, {
      state: 'CHANGES_REQUESTED',
      body: 'Please fix this',
    });

    expect(mockedAuthorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'reviewer-1');
  });

  it('requires only READ access for comment-only review', async () => {
    await submitPullRequestReview('reader-1', 'asil', 'demo', 1, {
      state: 'COMMENTED',
      body: 'Question',
    });

    expect(mockedAuthorize).toHaveBeenCalledWith('repo-1', 'READ', 'reader-1');
  });

  it('prevents PR author from approving own PR', async () => {
    await expect(
      submitPullRequestReview('author-1', 'asil', 'demo', 1, {
        state: 'APPROVED',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'PULL_REQUEST_SELF_REVIEW_NOT_ALLOWED',
    });

    expect(mockedReviewCreate).not.toHaveBeenCalled();
  });

  it('prevents PR author from requesting changes on own PR', async () => {
    await expect(
      submitPullRequestReview('author-1', 'asil', 'demo', 1, {
        state: 'CHANGES_REQUESTED',
        body: 'No',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'PULL_REQUEST_SELF_REVIEW_NOT_ALLOWED',
    });
  });

  it('allows PR author to leave a comment-only review', async () => {
    await submitPullRequestReview('author-1', 'asil', 'demo', 1, {
      state: 'COMMENTED',
      body: 'Additional context',
    });

    expect(mockedReviewCreate).toHaveBeenCalled();
  });

  it('rejects actionable review on closed PR', async () => {
    mockedPullRequestFindFirst.mockResolvedValueOnce({
      ...pullRequest,
      state: 'CLOSED',
    });

    await expect(
      submitPullRequestReview('reviewer-1', 'asil', 'demo', 1, {
        state: 'APPROVED',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PULL_REQUEST_NOT_OPEN',
    });

    expect(mockedAuthorize).not.toHaveBeenCalled();
  });

  it('creates general comment with READ permission in a transaction', async () => {
    const tx = {
      pullRequestConversation: {
        create: vi.fn().mockResolvedValue(conversation),
        findUnique: vi.fn().mockResolvedValue({
          ...conversation,
          resolvedBy: null,
          comments: [],
        }),
      },
      pullRequestReviewComment: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    mockedTransaction.mockImplementationOnce(async (callback) => callback(tx as never));

    await createGeneralPullRequestComment('reader-1', 'asil', 'demo', 1, {
      body: 'General discussion',
    });

    expect(mockedAuthorize).toHaveBeenCalledWith('repo-1', 'READ', 'reader-1');

    expect(tx.pullRequestConversation.create).toHaveBeenCalledWith({
      data: {
        pullRequestId: 'pr-1',
        type: 'GENERAL',
      },
    });

    expect(tx.pullRequestReviewComment.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'conversation-1',
        authorId: 'reader-1',
        body: 'General discussion',
      },
    });
  });

  it('creates inline comment from validated Git anchor', async () => {
    const tx = {
      pullRequestConversation: {
        create: vi.fn().mockResolvedValue({
          ...conversation,
          type: 'INLINE',
        }),
        findUnique: vi.fn().mockResolvedValue({
          ...conversation,
          type: 'INLINE',
          path: 'src/demo.ts',
          line: 2,
          side: 'RIGHT',
          baseSha: BASE_SHA,
          headSha: HEAD_SHA,
          resolvedBy: null,
          comments: [],
        }),
      },
      pullRequestReviewComment: {
        create: vi.fn().mockResolvedValue({}),
      },
    };

    mockedTransaction.mockImplementationOnce(async (callback) => callback(tx as never));

    const result = await createInlinePullRequestComment('reader-1', 'asil', 'demo', 1, {
      body: 'Check this',
      path: 'src/demo.ts',
      line: 2,
      side: 'RIGHT',
    });

    expect(mockedValidateAnchor).toHaveBeenCalledWith(
      'asil',
      'demo',
      'feature',
      'main',
      'src/demo.ts',
      2,
      'RIGHT',
    );

    expect(result.outdated).toBe(false);
  });

  it('rejects inline comment on merged PR', async () => {
    mockedPullRequestFindFirst.mockResolvedValueOnce({
      ...pullRequest,
      state: 'MERGED',
    });

    await expect(
      createInlinePullRequestComment('reader-1', 'asil', 'demo', 1, {
        body: 'No longer current',
        path: 'src/demo.ts',
        line: 2,
        side: 'RIGHT',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PULL_REQUEST_NOT_OPEN',
    });

    expect(mockedValidateAnchor).not.toHaveBeenCalled();
  });

  it('calculates latest actionable review per reviewer', async () => {
    mockedReviewFindMany.mockResolvedValueOnce([
      {
        reviewerId: 'reviewer-1',
        state: 'APPROVED',
        createdAt: new Date('2026-10-07T12:00:00Z'),
        id: 'r3',
      },
      {
        reviewerId: 'reviewer-2',
        state: 'CHANGES_REQUESTED',
        createdAt: new Date('2026-10-07T11:00:00Z'),
        id: 'r2',
      },
      {
        reviewerId: 'reviewer-1',
        state: 'CHANGES_REQUESTED',
        createdAt: new Date('2026-10-07T10:00:00Z'),
        id: 'r1',
      },
    ] as never);

    const result = await getPullRequestReviewState('asil', 'demo', 1);

    expect(result).toEqual({
      status: 'CHANGES_REQUESTED',
      approvedBy: ['reviewer-1'],
      changesRequestedBy: ['reviewer-2'],
    });

    expect(mockedReviewFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pullRequestId: 'pr-1',
          headSha: HEAD_SHA,
          state: {
            in: ['APPROVED', 'CHANGES_REQUESTED'],
          },
        },
      }),
    );
  });

  it('returns APPROVED when current reviews contain approvals only', async () => {
    mockedReviewFindMany.mockResolvedValueOnce([
      {
        reviewerId: 'reviewer-1',
        state: 'APPROVED',
        createdAt: new Date(),
        id: 'r1',
      },
    ] as never);

    await expect(getPullRequestReviewState('asil', 'demo', 1)).resolves.toEqual({
      status: 'APPROVED',
      approvedBy: ['reviewer-1'],
      changesRequestedBy: [],
    });
  });

  it('returns REVIEW_REQUIRED when no current actionable review exists', async () => {
    mockedReviewFindMany.mockResolvedValueOnce([]);

    await expect(getPullRequestReviewState('asil', 'demo', 1)).resolves.toEqual({
      status: 'REVIEW_REQUIRED',
      approvedBy: [],
      changesRequestedBy: [],
    });
  });

  it('marks inline conversation outdated when current Git head moved', async () => {
    mockedConversationFindMany.mockResolvedValueOnce([
      {
        ...conversation,
        type: 'INLINE',
        path: 'src/demo.ts',
        line: 2,
        side: 'RIGHT',
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        resolvedBy: null,
        comments: [],
      },
    ] as never);

    mockedRefs.mockResolvedValueOnce({
      objectFormat: 'sha1',
      symbolicHead: 'refs/heads/main',
      defaultBranch: 'main',
      head: BASE_SHA,
      branches: [
        {
          name: 'main',
          ref: 'refs/heads/main',
          oid: BASE_SHA,
        },
        {
          name: 'feature',
          ref: 'refs/heads/feature',
          oid: '3333333333333333333333333333333333333333',
        },
      ],
      tags: [],
    } as never);

    const result = await listPullRequestConversationsWithOutdatedState('asil', 'demo', 1);

    expect(result[0]?.outdated).toBe(true);
    expect(mockedRefs).toHaveBeenCalledTimes(1);
  });

  it('never marks general conversation as outdated', async () => {
    mockedConversationFindMany.mockResolvedValueOnce([
      {
        ...conversation,
        resolvedBy: null,
        comments: [],
      },
    ] as never);

    const result = await listPullRequestConversationsWithOutdatedState('asil', 'demo', 1);

    expect(result[0]?.outdated).toBe(false);
  });

  it('adds a reply to an existing conversation with READ access', async () => {
    mockedConversationFindFirst.mockResolvedValueOnce(conversation);

    mockedCommentCreate.mockResolvedValueOnce({
      id: 'comment-reply',
      conversationId: 'conversation-1',
      authorId: 'reader-1',
      reviewId: null,
      body: 'Reply',
      createdAt: new Date(),
      updatedAt: new Date(),
      author: {
        id: 'reader-1',
        username: 'reader',
        name: 'Reader',
        avatarUrl: null,
      },
      review: null,
    } as never);

    const result = await createPullRequestConversationComment(
      'reader-1',
      'asil',
      'demo',
      1,
      'conversation-1',
      {
        body: 'Reply',
      },
    );

    expect(mockedAuthorize).toHaveBeenCalledWith('repo-1', 'READ', 'reader-1');

    expect(mockedConversationFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'conversation-1',
        pullRequestId: 'pr-1',
      },
    });

    expect(mockedCommentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          conversationId: 'conversation-1',
          authorId: 'reader-1',
          body: 'Reply',
        },
      }),
    );

    expect(result.body).toBe('Reply');
  });

  it('atomically resolves a conversation with WRITE access', async () => {
    mockedConversationFindFirst.mockResolvedValueOnce(conversation);

    mockedConversationUpdateMany.mockResolvedValueOnce({
      count: 1,
    });

    mockedConversationFindUniqueOrThrow.mockResolvedValueOnce({
      ...conversation,
      resolvedAt: new Date(),
      resolvedById: 'reviewer-1',
    } as never);

    await resolvePullRequestConversation('reviewer-1', 'asil', 'demo', 1, 'conversation-1');

    expect(mockedAuthorize).toHaveBeenCalledWith('repo-1', 'WRITE', 'reviewer-1');

    expect(mockedConversationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-1',
        pullRequestId: 'pr-1',
        resolvedAt: null,
      },
      data: {
        resolvedAt: expect.any(Date),
        resolvedById: 'reviewer-1',
      },
    });

    expect(mockedConversationFindUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'conversation-1',
        },
      }),
    );
  });

  it('rejects resolve when atomic state transition loses the race', async () => {
    mockedConversationFindFirst.mockResolvedValueOnce(conversation);

    mockedConversationUpdateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      resolvePullRequestConversation('reviewer-1', 'asil', 'demo', 1, 'conversation-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PULL_REQUEST_CONVERSATION_ALREADY_RESOLVED',
    });

    expect(mockedConversationFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('atomically reopens a resolved conversation', async () => {
    mockedConversationFindFirst.mockResolvedValueOnce({
      ...conversation,
      resolvedAt: new Date(),
      resolvedById: 'reviewer-1',
    });

    mockedConversationUpdateMany.mockResolvedValueOnce({
      count: 1,
    });

    mockedConversationFindUniqueOrThrow.mockResolvedValueOnce(conversation as never);

    await reopenPullRequestConversation('reviewer-1', 'asil', 'demo', 1, 'conversation-1');

    expect(mockedConversationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-1',
        pullRequestId: 'pr-1',
        resolvedAt: {
          not: null,
        },
      },
      data: {
        resolvedAt: null,
        resolvedById: null,
      },
    });

    expect(mockedConversationFindUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'conversation-1',
        },
      }),
    );
  });

  it('rejects reopen when atomic state transition loses the race', async () => {
    mockedConversationFindFirst.mockResolvedValueOnce({
      ...conversation,
      resolvedAt: new Date(),
      resolvedById: 'reviewer-1',
    });

    mockedConversationUpdateMany.mockResolvedValueOnce({
      count: 0,
    });

    await expect(
      reopenPullRequestConversation('reviewer-1', 'asil', 'demo', 1, 'conversation-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PULL_REQUEST_CONVERSATION_ALREADY_OPEN',
    });

    expect(mockedConversationFindUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('allows only comment author to edit', async () => {
    mockedCommentFindFirst.mockResolvedValueOnce({
      id: 'comment-1',
      conversationId: 'conversation-1',
      authorId: 'other-user',
      reviewId: null,
      body: 'Original',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      updatePullRequestReviewComment('reviewer-1', 'asil', 'demo', 1, 'comment-1', {
        body: 'Edited',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'PULL_REQUEST_COMMENT_EDIT_DENIED',
    });

    expect(mockedCommentUpdate).not.toHaveBeenCalled();
  });

  it('edits comment owned by current user', async () => {
    mockedCommentFindFirst.mockResolvedValueOnce({
      id: 'comment-1',
      conversationId: 'conversation-1',
      authorId: 'reviewer-1',
      reviewId: null,
      body: 'Original',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockedCommentUpdate.mockResolvedValueOnce({
      id: 'comment-1',
      conversationId: 'conversation-1',
      authorId: 'reviewer-1',
      reviewId: null,
      body: 'Edited',
      createdAt: new Date(),
      updatedAt: new Date(),
      author: review.reviewer,
      review: null,
    } as never);

    await updatePullRequestReviewComment('reviewer-1', 'asil', 'demo', 1, 'comment-1', {
      body: 'Edited',
    });

    expect(mockedCommentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'comment-1',
        },
        data: {
          body: 'Edited',
        },
      }),
    );
  });

  it('allows only comment author to delete', async () => {
    mockedCommentFindFirst.mockResolvedValueOnce({
      id: 'comment-1',
      authorId: 'other-user',
      conversationId: 'conversation-1',
    } as never);

    await expect(
      deletePullRequestReviewComment('reviewer-1', 'asil', 'demo', 1, 'comment-1'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'PULL_REQUEST_COMMENT_DELETE_DENIED',
    });

    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it('deletes empty conversation with its final comment transactionally', async () => {
    mockedCommentFindFirst.mockResolvedValueOnce({
      id: 'comment-1',
      authorId: 'reviewer-1',
      conversationId: 'conversation-1',
    } as never);

    const tx = {
      pullRequestReviewComment: {
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      pullRequestConversation: {
        delete: vi.fn().mockResolvedValue({}),
      },
    };

    mockedTransaction.mockImplementationOnce(async (callback) => callback(tx as never));

    await deletePullRequestReviewComment('reviewer-1', 'asil', 'demo', 1, 'comment-1');

    expect(tx.pullRequestReviewComment.delete).toHaveBeenCalledWith({
      where: {
        id: 'comment-1',
      },
    });

    expect(tx.pullRequestConversation.delete).toHaveBeenCalledWith({
      where: {
        id: 'conversation-1',
      },
    });
  });

  it('keeps conversation when other comments remain', async () => {
    mockedCommentFindFirst.mockResolvedValueOnce({
      id: 'comment-1',
      authorId: 'reviewer-1',
      conversationId: 'conversation-1',
    } as never);

    const tx = {
      pullRequestReviewComment: {
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(2),
      },
      pullRequestConversation: {
        delete: vi.fn(),
      },
    };

    mockedTransaction.mockImplementationOnce(async (callback) => callback(tx as never));

    await deletePullRequestReviewComment('reviewer-1', 'asil', 'demo', 1, 'comment-1');

    expect(tx.pullRequestConversation.delete).not.toHaveBeenCalled();
  });

  it('propagates repository authorization denial', async () => {
    mockedAuthorize.mockRejectedValueOnce(
      Object.assign(new Error('denied'), {
        statusCode: 403,
        code: 'REPOSITORY_ACCESS_DENIED',
      }),
    );

    await expect(
      submitPullRequestReview('reader-1', 'asil', 'demo', 1, {
        state: 'APPROVED',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'REPOSITORY_ACCESS_DENIED',
    });

    expect(mockedReviewCreate).not.toHaveBeenCalled();
  });
});
