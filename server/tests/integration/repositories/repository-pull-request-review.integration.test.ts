import type { NextFunction, Request, Response } from 'express';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../../../src/app.js';

import {
  createGeneralPullRequestComment,
  createInlinePullRequestComment,
  createPullRequestConversationComment,
  deletePullRequestReviewComment,
  getPullRequestReviewState,
  listPullRequestConversationsWithOutdatedState,
  listPullRequestReviews,
  reopenPullRequestConversation,
  resolvePullRequestConversation,
  submitPullRequestReview,
  updatePullRequestReviewComment,
} from '../../../src/services/pull-requests/pull-request-review.service.js';

vi.mock('../../../src/controllers/git/git-http.controller.js', () => ({
  gitHttpController: vi.fn(),
}));

vi.mock('../../../src/middleware/auth.middleware.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId: string }).userId = 'user-1';
    next();
  },
}));

vi.mock('../../../src/middleware/optional-auth.middleware.js', () => ({
  optionalAuthMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      (req as Request & { userId?: string }).userId = 'user-1';
    }

    next();
  },
}));

vi.mock('../../../src/services/pull-requests/pull-request-review.service.js', () => ({
  createGeneralPullRequestComment: vi.fn(),
  createInlinePullRequestComment: vi.fn(),
  createPullRequestConversationComment: vi.fn(),
  deletePullRequestReviewComment: vi.fn(),
  getPullRequestReviewState: vi.fn(),
  listPullRequestConversationsWithOutdatedState: vi.fn(),
  listPullRequestReviews: vi.fn(),
  reopenPullRequestConversation: vi.fn(),
  resolvePullRequestConversation: vi.fn(),
  submitPullRequestReview: vi.fn(),
  updatePullRequestReviewComment: vi.fn(),
}));

const mockedSubmitReview = vi.mocked(submitPullRequestReview);
const mockedListReviews = vi.mocked(listPullRequestReviews);
const mockedCreateGeneral = vi.mocked(createGeneralPullRequestComment);
const mockedCreateInline = vi.mocked(createInlinePullRequestComment);
const mockedCreateConversationComment = vi.mocked(createPullRequestConversationComment);
const mockedListConversations = vi.mocked(listPullRequestConversationsWithOutdatedState);
const mockedReviewState = vi.mocked(getPullRequestReviewState);
const mockedResolve = vi.mocked(resolvePullRequestConversation);
const mockedReopen = vi.mocked(reopenPullRequestConversation);
const mockedUpdateComment = vi.mocked(updatePullRequestReviewComment);
const mockedDeleteComment = vi.mocked(deletePullRequestReviewComment);

const reviewer = {
  id: 'user-1',
  username: 'reviewer',
  name: 'Reviewer',
  avatarUrl: null,
};

const review = {
  id: 'review-1',
  pullRequestId: 'pr-1',
  reviewerId: 'user-1',
  state: 'APPROVED' as const,
  body: null,
  headSha: '2222222222222222222222222222222222222222',
  createdAt: new Date('2026-10-07T10:00:00Z'),
  updatedAt: new Date('2026-10-07T10:00:00Z'),
  reviewer,
};

const comment = {
  id: 'comment-1',
  conversationId: 'conversation-1',
  authorId: 'user-1',
  reviewId: null,
  body: 'Looks good',
  createdAt: new Date('2026-10-07T10:00:00Z'),
  updatedAt: new Date('2026-10-07T10:00:00Z'),
  author: reviewer,
  review: null,
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
  resolvedBy: null,
  comments: [comment],
};

describe('repository pull request review API', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockedSubmitReview.mockResolvedValue(review);
    mockedListReviews.mockResolvedValue([review]);
    mockedCreateGeneral.mockResolvedValue(conversation);
    mockedCreateConversationComment.mockResolvedValue({
      id: 'comment-reply',
      conversationId: 'conversation-1',
      authorId: 'user-1',
      reviewId: null,
      body: 'Reply to discussion',
      createdAt: new Date('2026-10-07T10:10:00Z'),
      updatedAt: new Date('2026-10-07T10:10:00Z'),
      author: {
        id: 'user-1',
        username: 'user',
        name: 'User',
        avatarUrl: null,
      },
      review: null,
    } as never);

    mockedCreateInline.mockResolvedValue({
      ...conversation,
      type: 'INLINE',
      path: 'src/demo.ts',
      line: 2,
      side: 'RIGHT',
      baseSha: '1111111111111111111111111111111111111111',
      headSha: '2222222222222222222222222222222222222222',
      outdated: false,
    });
    mockedListConversations.mockResolvedValue([
      {
        ...conversation,
        outdated: false,
      },
    ]);
    mockedReviewState.mockResolvedValue({
      status: 'APPROVED',
      approvedBy: ['user-1'],
      changesRequestedBy: [],
    });
    mockedResolve.mockResolvedValue({
      ...conversation,
      resolvedAt: new Date('2026-10-07T11:00:00Z'),
      resolvedById: 'user-1',
      resolvedBy: reviewer,
    });
    mockedReopen.mockResolvedValue(conversation);
    mockedUpdateComment.mockResolvedValue({
      ...comment,
      body: 'Updated comment',
    });
    mockedDeleteComment.mockResolvedValue(undefined);
  });

  it('submits an approval review', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/pulls/1/reviews')
      .set('Authorization', 'Bearer test')
      .send({
        state: 'APPROVED',
      })
      .expect(201);

    expect(response.body.data.review.state).toBe('APPROVED');

    expect(mockedSubmitReview).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, {
      state: 'APPROVED',
    });
  });

  it('submits a request-changes review', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/pulls/1/reviews')
      .set('Authorization', 'Bearer test')
      .send({
        state: 'CHANGES_REQUESTED',
        body: 'Please fix this',
      })
      .expect(201);

    expect(mockedSubmitReview).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, {
      state: 'CHANGES_REQUESTED',
      body: 'Please fix this',
    });
  });

  it('rejects comment-only review without a body', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/pulls/1/reviews')
      .set('Authorization', 'Bearer test')
      .send({
        state: 'COMMENTED',
      })
      .expect(400);

    expect(mockedSubmitReview).not.toHaveBeenCalled();
  });

  it('lists reviews', async () => {
    const response = await request(app)
      .get('/api/repositories/asil/demo/pulls/1/reviews')
      .expect(200);

    expect(response.body.data.reviews).toHaveLength(1);

    expect(mockedListReviews).toHaveBeenCalledWith('asil', 'demo', 1, undefined);
  });

  it('returns calculated review state', async () => {
    const response = await request(app)
      .get('/api/repositories/asil/demo/pulls/1/review-state')
      .expect(200);

    expect(response.body.data.reviewState.status).toBe('APPROVED');
  });

  it('creates a general PR comment', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/pulls/1/comments')
      .set('Authorization', 'Bearer test')
      .send({
        body: 'Looks good',
      })
      .expect(201);

    expect(mockedCreateGeneral).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, {
      body: 'Looks good',
    });
  });

  it('creates an inline diff comment', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/pulls/1/inline-comments')
      .set('Authorization', 'Bearer test')
      .send({
        body: 'Check this line',
        path: 'src/demo.ts',
        line: 2,
        side: 'RIGHT',
      })
      .expect(201);

    expect(response.body.data.conversation.outdated).toBe(false);

    expect(mockedCreateInline).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, {
      body: 'Check this line',
      path: 'src/demo.ts',
      line: 2,
      side: 'RIGHT',
    });
  });

  it('rejects invalid inline comment input', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/pulls/1/inline-comments')
      .set('Authorization', 'Bearer test')
      .send({
        body: 'Invalid',
        path: '',
        line: 0,
        side: 'CENTER',
      })
      .expect(400);

    expect(mockedCreateInline).not.toHaveBeenCalled();
  });

  it('adds a comment to an existing conversation', async () => {
    const response = await request(app)
      .post('/api/repositories/asil/demo/pulls/1/conversations/conversation-1/comments')
      .send({
        body: 'Reply to discussion',
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.comment.body).toBe('Reply to discussion');

    expect(mockedCreateConversationComment).toHaveBeenCalledWith(
      'user-1',
      'asil',
      'demo',
      1,
      'conversation-1',
      {
        body: 'Reply to discussion',
      },
    );
  });

  it('rejects an invalid conversation reply body', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/pulls/1/conversations/conversation-1/comments')
      .send({
        body: '',
      })
      .expect(400);

    expect(mockedCreateConversationComment).not.toHaveBeenCalled();
  });

  it('lists conversations', async () => {
    const response = await request(app)
      .get('/api/repositories/asil/demo/pulls/1/conversations')
      .expect(200);

    expect(response.body.data.conversations).toHaveLength(1);
  });

  it('edits a comment', async () => {
    const response = await request(app)
      .patch('/api/repositories/asil/demo/pulls/1/comments/comment-1')
      .set('Authorization', 'Bearer test')
      .send({
        body: 'Updated comment',
      })
      .expect(200);

    expect(response.body.data.comment.body).toBe('Updated comment');

    expect(mockedUpdateComment).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, 'comment-1', {
      body: 'Updated comment',
    });
  });

  it('deletes a comment', async () => {
    await request(app)
      .delete('/api/repositories/asil/demo/pulls/1/comments/comment-1')
      .set('Authorization', 'Bearer test')
      .expect(204);

    expect(mockedDeleteComment).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, 'comment-1');
  });

  it('resolves a conversation', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/pulls/1/conversations/conversation-1/resolve')
      .set('Authorization', 'Bearer test')
      .expect(200);

    expect(mockedResolve).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, 'conversation-1');
  });

  it('reopens a conversation', async () => {
    await request(app)
      .post('/api/repositories/asil/demo/pulls/1/conversations/conversation-1/reopen')
      .set('Authorization', 'Bearer test')
      .expect(200);

    expect(mockedReopen).toHaveBeenCalledWith('user-1', 'asil', 'demo', 1, 'conversation-1');
  });

  it('rejects an invalid PR number', async () => {
    await request(app).get('/api/repositories/asil/demo/pulls/nope/reviews').expect(400);

    expect(mockedListReviews).not.toHaveBeenCalled();
  });
});
