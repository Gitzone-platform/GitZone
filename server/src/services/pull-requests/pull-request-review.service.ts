import type { PullRequestReviewState } from '../../generated/prisma/enums.js';

import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';

import { getGitRepositoryRefs } from '../git/git-ref.service.js';
import { authorizeRepositoryAccess } from '../repositories/repository-authorization.service.js';

import type {
  CreateGeneralPullRequestCommentInput,
  CreateInlinePullRequestCommentInput,
  SubmitPullRequestReviewInput,
  UpdatePullRequestReviewCommentInput,
} from '../../validations/pull-requests/pull-request-review.validation.js';

import { validatePullRequestDiffAnchor } from './pull-request-review-git.service.js';

const publicUserSelect = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
} as const;

const reviewInclude = {
  reviewer: {
    select: publicUserSelect,
  },
} as const;

const conversationInclude = {
  resolvedBy: {
    select: publicUserSelect,
  },
  comments: {
    include: {
      author: {
        select: publicUserSelect,
      },
      review: {
        select: {
          id: true,
          state: true,
          headSha: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
} as const;

const findPullRequest = async (username: string, repositoryName: string, number: number) => {
  const pullRequest = await prisma.pullRequest.findFirst({
    where: {
      number,
      repository: {
        name: repositoryName,
        owner: {
          username,
        },
      },
    },
    include: {
      repository: {
        select: {
          id: true,
          name: true,
          ownerId: true,
        },
      },
      author: {
        select: publicUserSelect,
      },
    },
  });

  if (!pullRequest) {
    throw new AppError('Pull request not found', 404, 'PULL_REQUEST_NOT_FOUND');
  }

  return pullRequest;
};

const requireOpenPullRequest = (state: 'OPEN' | 'CLOSED' | 'MERGED'): void => {
  if (state !== 'OPEN') {
    throw new AppError('Pull request is not open', 409, 'PULL_REQUEST_NOT_OPEN');
  }
};

const resolvePullRequestHeadSha = async (
  username: string,
  repositoryName: string,
  sourceBranch: string,
): Promise<string> => {
  const refs = await getGitRepositoryRefs(username, repositoryName);

  const source = refs.branches.find((branch) => branch.name === sourceBranch);

  if (!source) {
    throw new AppError(
      'Pull request source branch not found',
      409,
      'PULL_REQUEST_SOURCE_BRANCH_NOT_FOUND',
    );
  }

  return source.oid;
};

export const submitPullRequestReview = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  input: SubmitPullRequestReviewInput,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  requireOpenPullRequest(pullRequest.state);

  if (input.state === 'APPROVED' || input.state === 'CHANGES_REQUESTED') {
    await authorizeRepositoryAccess(pullRequest.repositoryId, 'WRITE', userId);

    if (pullRequest.authorId === userId) {
      throw new AppError(
        'Pull request authors cannot approve or request changes on their own pull request',
        403,
        'PULL_REQUEST_SELF_REVIEW_NOT_ALLOWED',
      );
    }
  } else {
    await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);
  }

  const headSha = await resolvePullRequestHeadSha(
    username,
    repositoryName,
    pullRequest.sourceBranch,
  );

  return prisma.pullRequestReview.create({
    data: {
      pullRequestId: pullRequest.id,
      reviewerId: userId,
      state: input.state,
      body: input.body ?? null,
      headSha,
    },
    include: reviewInclude,
  });
};

export const listPullRequestReviews = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);

  return prisma.pullRequestReview.findMany({
    where: {
      pullRequestId: pullRequest.id,
    },
    include: reviewInclude,
    orderBy: [
      {
        createdAt: 'asc',
      },
      {
        id: 'asc',
      },
    ],
  });
};

export const createGeneralPullRequestComment = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  input: CreateGeneralPullRequestCommentInput,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.pullRequestConversation.create({
      data: {
        pullRequestId: pullRequest.id,
        type: 'GENERAL',
      },
    });

    await tx.pullRequestReviewComment.create({
      data: {
        conversationId: conversation.id,
        authorId: userId,
        body: input.body,
      },
    });

    const result = await tx.pullRequestConversation.findUnique({
      where: {
        id: conversation.id,
      },
      include: conversationInclude,
    });

    if (!result) {
      throw new AppError(
        'Pull request conversation could not be created',
        500,
        'PULL_REQUEST_CONVERSATION_CREATE_FAILED',
      );
    }

    return result;
  });
};

export const listPullRequestConversations = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);

  return prisma.pullRequestConversation.findMany({
    where: {
      pullRequestId: pullRequest.id,
    },
    include: conversationInclude,
    orderBy: [
      {
        createdAt: 'asc',
      },
      {
        id: 'asc',
      },
    ],
  });
};

export type PullRequestReviewStateSummary = {
  status: 'REVIEW_REQUIRED' | 'APPROVED' | 'CHANGES_REQUESTED';
  approvedBy: string[];
  changesRequestedBy: string[];
};

export const getPullRequestReviewState = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
): Promise<PullRequestReviewStateSummary> => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);

  const currentHeadSha = await resolvePullRequestHeadSha(
    username,
    repositoryName,
    pullRequest.sourceBranch,
  );

  const reviews = await prisma.pullRequestReview.findMany({
    where: {
      pullRequestId: pullRequest.id,
      headSha: currentHeadSha,
      state: {
        in: ['APPROVED', 'CHANGES_REQUESTED'],
      },
    },
    select: {
      reviewerId: true,
      state: true,
      createdAt: true,
      id: true,
    },
    orderBy: [
      {
        createdAt: 'desc',
      },
      {
        id: 'desc',
      },
    ],
  });

  const latestByReviewer = new Map<string, PullRequestReviewState>();

  for (const review of reviews) {
    if (!latestByReviewer.has(review.reviewerId)) {
      latestByReviewer.set(review.reviewerId, review.state);
    }
  }

  const approvedBy: string[] = [];
  const changesRequestedBy: string[] = [];

  for (const [reviewerId, state] of latestByReviewer) {
    if (state === 'APPROVED') {
      approvedBy.push(reviewerId);
    }

    if (state === 'CHANGES_REQUESTED') {
      changesRequestedBy.push(reviewerId);
    }
  }

  let status: PullRequestReviewStateSummary['status'] = 'REVIEW_REQUIRED';

  if (changesRequestedBy.length > 0) {
    status = 'CHANGES_REQUESTED';
  } else if (approvedBy.length > 0) {
    status = 'APPROVED';
  }

  return {
    status,
    approvedBy,
    changesRequestedBy,
  };
};
export const createInlinePullRequestComment = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  input: CreateInlinePullRequestCommentInput,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  requireOpenPullRequest(pullRequest.state);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);

  const anchor = await validatePullRequestDiffAnchor(
    username,
    repositoryName,
    pullRequest.sourceBranch,
    pullRequest.targetBranch,
    input.path,
    input.line,
    input.side,
  );

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.pullRequestConversation.create({
      data: {
        pullRequestId: pullRequest.id,
        type: 'INLINE',
        path: anchor.path,
        line: anchor.line,
        side: anchor.side,
        baseSha: anchor.baseSha,
        headSha: anchor.headSha,
      },
    });

    await tx.pullRequestReviewComment.create({
      data: {
        conversationId: conversation.id,
        authorId: userId,
        body: input.body,
      },
    });

    const result = await tx.pullRequestConversation.findUnique({
      where: {
        id: conversation.id,
      },
      include: conversationInclude,
    });

    if (!result) {
      throw new AppError(
        'Inline pull request conversation could not be created',
        500,
        'PULL_REQUEST_CONVERSATION_CREATE_FAILED',
      );
    }

    return {
      ...result,
      outdated: false,
    };
  });
};

export const listPullRequestConversationsWithOutdatedState = async (
  username: string,
  repositoryName: string,
  number: number,
  userId?: string,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);

  const conversations = await prisma.pullRequestConversation.findMany({
    where: {
      pullRequestId: pullRequest.id,
    },
    include: conversationInclude,
    orderBy: [
      {
        createdAt: 'asc',
      },
      {
        id: 'asc',
      },
    ],
  });

  const currentRefs = await getGitRepositoryRefs(username, repositoryName);

  const source = currentRefs.branches.find((branch) => branch.name === pullRequest.sourceBranch);

  const target = currentRefs.branches.find((branch) => branch.name === pullRequest.targetBranch);

  return conversations.map((conversation) => {
    if (conversation.type !== 'INLINE') {
      return {
        ...conversation,
        outdated: false,
      };
    }

    const outdated =
      !source ||
      !target ||
      !conversation.baseSha ||
      !conversation.headSha ||
      conversation.baseSha !== target.oid ||
      conversation.headSha !== source.oid;

    return {
      ...conversation,
      outdated,
    };
  });
};

const findConversationForPullRequest = async (pullRequestId: string, conversationId: string) => {
  const conversation = await prisma.pullRequestConversation.findFirst({
    where: {
      id: conversationId,
      pullRequestId,
    },
  });

  if (!conversation) {
    throw new AppError(
      'Pull request conversation not found',
      404,
      'PULL_REQUEST_CONVERSATION_NOT_FOUND',
    );
  }

  return conversation;
};

export const createPullRequestConversationComment = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  conversationId: string,
  input: CreateGeneralPullRequestCommentInput,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);

  const conversation = await findConversationForPullRequest(pullRequest.id, conversationId);

  return prisma.pullRequestReviewComment.create({
    data: {
      conversationId: conversation.id,
      authorId: userId,
      body: input.body,
    },
    include: {
      author: {
        select: publicUserSelect,
      },
      review: {
        select: {
          id: true,
          state: true,
          headSha: true,
        },
      },
    },
  });
};

export const resolvePullRequestConversation = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  conversationId: string,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'WRITE', userId);

  await findConversationForPullRequest(pullRequest.id, conversationId);

  const result = await prisma.pullRequestConversation.updateMany({
    where: {
      id: conversationId,
      pullRequestId: pullRequest.id,
      resolvedAt: null,
    },
    data: {
      resolvedAt: new Date(),
      resolvedById: userId,
    },
  });

  if (result.count !== 1) {
    throw new AppError(
      'Pull request conversation is already resolved',
      409,
      'PULL_REQUEST_CONVERSATION_ALREADY_RESOLVED',
    );
  }

  return prisma.pullRequestConversation.findUniqueOrThrow({
    where: {
      id: conversationId,
    },
    include: conversationInclude,
  });
};

export const reopenPullRequestConversation = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  conversationId: string,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'WRITE', userId);

  await findConversationForPullRequest(pullRequest.id, conversationId);

  const result = await prisma.pullRequestConversation.updateMany({
    where: {
      id: conversationId,
      pullRequestId: pullRequest.id,
      resolvedAt: {
        not: null,
      },
    },
    data: {
      resolvedAt: null,
      resolvedById: null,
    },
  });

  if (result.count !== 1) {
    throw new AppError(
      'Pull request conversation is already open',
      409,
      'PULL_REQUEST_CONVERSATION_ALREADY_OPEN',
    );
  }

  return prisma.pullRequestConversation.findUniqueOrThrow({
    where: {
      id: conversationId,
    },
    include: conversationInclude,
  });
};

export const updatePullRequestReviewComment = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  commentId: string,
  input: UpdatePullRequestReviewCommentInput,
) => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);

  const comment = await prisma.pullRequestReviewComment.findFirst({
    where: {
      id: commentId,
      conversation: {
        pullRequestId: pullRequest.id,
      },
    },
  });

  if (!comment) {
    throw new AppError('Pull request comment not found', 404, 'PULL_REQUEST_COMMENT_NOT_FOUND');
  }

  if (comment.authorId !== userId) {
    throw new AppError(
      'Only the comment author can edit this comment',
      403,
      'PULL_REQUEST_COMMENT_EDIT_DENIED',
    );
  }

  return prisma.pullRequestReviewComment.update({
    where: {
      id: comment.id,
    },
    data: {
      body: input.body,
    },
    include: {
      author: {
        select: publicUserSelect,
      },
      review: {
        select: {
          id: true,
          state: true,
          headSha: true,
        },
      },
    },
  });
};

export const deletePullRequestReviewComment = async (
  userId: string,
  username: string,
  repositoryName: string,
  number: number,
  commentId: string,
): Promise<void> => {
  const pullRequest = await findPullRequest(username, repositoryName, number);

  await authorizeRepositoryAccess(pullRequest.repositoryId, 'READ', userId);

  const comment = await prisma.pullRequestReviewComment.findFirst({
    where: {
      id: commentId,
      conversation: {
        pullRequestId: pullRequest.id,
      },
    },
    select: {
      id: true,
      authorId: true,
      conversationId: true,
    },
  });

  if (!comment) {
    throw new AppError('Pull request comment not found', 404, 'PULL_REQUEST_COMMENT_NOT_FOUND');
  }

  if (comment.authorId !== userId) {
    throw new AppError(
      'Only the comment author can delete this comment',
      403,
      'PULL_REQUEST_COMMENT_DELETE_DENIED',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.pullRequestReviewComment.delete({
      where: {
        id: comment.id,
      },
    });

    const remaining = await tx.pullRequestReviewComment.count({
      where: {
        conversationId: comment.conversationId,
      },
    });

    if (remaining === 0) {
      await tx.pullRequestConversation.delete({
        where: {
          id: comment.conversationId,
        },
      });
    }
  });
};
