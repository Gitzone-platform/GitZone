import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';

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
} from '../../services/pull-requests/pull-request-review.service.js';

import {
  conversationIdSchema,
  createGeneralPullRequestCommentSchema,
  createInlinePullRequestCommentSchema,
  reviewCommentIdSchema,
  submitPullRequestReviewSchema,
  updatePullRequestReviewCommentSchema,
} from '../../validations/pull-requests/pull-request-review.validation.js';

import { pullRequestNumberSchema } from '../../validations/pull-requests/pull-request.validation.js';

const getRepositoryParams = (
  req: Request,
): {
  username: string;
  name: string;
} => {
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Username and repository name are required',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  return {
    username,
    name,
  };
};

const getPullRequestNumber = (req: Request): number => {
  const parsed = pullRequestNumberSchema.safeParse(req.params.number);

  if (!parsed.success) {
    throw new AppError('Invalid pull request number', 400, 'INVALID_PULL_REQUEST_NUMBER');
  }

  return parsed.data;
};

export const submitReview = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);

  const parsed = submitPullRequestReviewSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid pull request review data', 400, 'INVALID_PULL_REQUEST_REVIEW_DATA');
  }

  const review = await submitPullRequestReview(
    authenticatedReq.userId,
    username,
    name,
    number,
    parsed.data,
  );

  res.status(201).json({
    success: true,
    data: {
      review,
    },
  });
};

export const listReviews = async (req: Request, res: Response): Promise<void> => {
  const optionalReq = req as OptionalAuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);

  const reviews = await listPullRequestReviews(username, name, number, optionalReq.userId);

  res.status(200).json({
    success: true,
    data: {
      reviews,
    },
  });
};

export const createGeneralComment = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);

  const parsed = createGeneralPullRequestCommentSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(
      'Invalid pull request comment data',
      400,
      'INVALID_PULL_REQUEST_COMMENT_DATA',
    );
  }

  const conversation = await createGeneralPullRequestComment(
    authenticatedReq.userId,
    username,
    name,
    number,
    parsed.data,
  );

  res.status(201).json({
    success: true,
    data: {
      conversation,
    },
  });
};

export const listConversations = async (req: Request, res: Response): Promise<void> => {
  const optionalReq = req as OptionalAuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);

  const conversations = await listPullRequestConversationsWithOutdatedState(
    username,
    name,
    number,
    optionalReq.userId,
  );

  res.status(200).json({
    success: true,
    data: {
      conversations,
    },
  });
};

export const getReviewState = async (req: Request, res: Response): Promise<void> => {
  const optionalReq = req as OptionalAuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);

  const reviewState = await getPullRequestReviewState(username, name, number, optionalReq.userId);

  res.status(200).json({
    success: true,
    data: {
      reviewState,
    },
  });
};
const getConversationId = (req: Request): string => {
  const parsed = conversationIdSchema.safeParse(req.params.conversationId);

  if (!parsed.success) {
    throw new AppError(
      'Invalid pull request conversation id',
      400,
      'INVALID_PULL_REQUEST_CONVERSATION_ID',
    );
  }

  return parsed.data;
};

const getCommentId = (req: Request): string => {
  const parsed = reviewCommentIdSchema.safeParse(req.params.commentId);

  if (!parsed.success) {
    throw new AppError('Invalid pull request comment id', 400, 'INVALID_PULL_REQUEST_COMMENT_ID');
  }

  return parsed.data;
};

export const createInlineComment = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);

  const parsed = createInlinePullRequestCommentSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(
      'Invalid inline pull request comment data',
      400,
      'INVALID_PULL_REQUEST_INLINE_COMMENT_DATA',
    );
  }

  const conversation = await createInlinePullRequestComment(
    authenticatedReq.userId,
    username,
    name,
    number,
    parsed.data,
  );

  res.status(201).json({
    success: true,
    data: {
      conversation,
    },
  });
};

export const editComment = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);
  const commentId = getCommentId(req);

  const parsed = updatePullRequestReviewCommentSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(
      'Invalid pull request comment data',
      400,
      'INVALID_PULL_REQUEST_COMMENT_DATA',
    );
  }

  const comment = await updatePullRequestReviewComment(
    authenticatedReq.userId,
    username,
    name,
    number,
    commentId,
    parsed.data,
  );

  res.status(200).json({
    success: true,
    data: {
      comment,
    },
  });
};

export const deleteComment = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);
  const commentId = getCommentId(req);

  await deletePullRequestReviewComment(authenticatedReq.userId, username, name, number, commentId);

  res.status(204).send();
};

export const createConversationComment = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);
  const conversationId = getConversationId(req);

  const parsed = createGeneralPullRequestCommentSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(
      'Invalid pull request comment data',
      400,
      'INVALID_PULL_REQUEST_COMMENT_DATA',
    );
  }

  const comment = await createPullRequestConversationComment(
    authenticatedReq.userId,
    username,
    name,
    number,
    conversationId,
    parsed.data,
  );

  res.status(201).json({
    success: true,
    data: {
      comment,
    },
  });
};

export const resolveConversation = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);
  const conversationId = getConversationId(req);

  const conversation = await resolvePullRequestConversation(
    authenticatedReq.userId,
    username,
    name,
    number,
    conversationId,
  );

  res.status(200).json({
    success: true,
    data: {
      conversation,
    },
  });
};

export const reopenConversation = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = getRepositoryParams(req);
  const number = getPullRequestNumber(req);
  const conversationId = getConversationId(req);

  const conversation = await reopenPullRequestConversation(
    authenticatedReq.userId,
    username,
    name,
    number,
    conversationId,
  );

  res.status(200).json({
    success: true,
    data: {
      conversation,
    },
  });
};
