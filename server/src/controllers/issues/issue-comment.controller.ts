import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';

import {
  createIssueComment,
  listIssueComments,
  updateIssueComment,
  deleteIssueComment,
} from '../../services/issues/issue-comment.service.js';

import { issueNumberSchema } from '../../validations/issues/issue.validation.js';

import {
  createIssueCommentSchema,
  updateIssueCommentSchema,
  issueCommentIdSchema,
  listIssueCommentsQuerySchema,
} from '../../validations/issues/issue-comment.validation.js';

const getParams = (req: Request) => {
  const { username, name, number } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  const parsedNumber = issueNumberSchema.safeParse(number);

  if (!parsedNumber.success) {
    throw new AppError('Invalid issue number', 400, 'INVALID_ISSUE_NUMBER');
  }

  return {
    username,
    repositoryName: name,
    number: parsedNumber.data,
  };
};

const getCommentId = (req: Request): string => {
  const parsed = issueCommentIdSchema.safeParse(req.params.commentId);

  if (!parsed.success) {
    throw new AppError('Invalid issue comment ID', 400, 'INVALID_ISSUE_COMMENT_ID');
  }

  return parsed.data;
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const parsed = createIssueCommentSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid issue comment data', 400, 'INVALID_ISSUE_COMMENT_DATA');
  }

  const userId = (req as AuthenticatedRequest).userId;

  const comment = await createIssueComment(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    parsed.data,
  );

  res.status(201).json({
    success: true,
    data: { comment },
  });
};

export const list = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const parsed = listIssueCommentsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError('Invalid issue comments query', 400, 'INVALID_ISSUE_COMMENTS_QUERY');
  }

  const userId = (req as OptionalAuthenticatedRequest).userId;

  const result = await listIssueComments(
    params.username,
    params.repositoryName,
    params.number,
    userId,
    parsed.data,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const commentId = getCommentId(req);
  const parsed = updateIssueCommentSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid issue comment update', 400, 'INVALID_ISSUE_COMMENT_UPDATE');
  }

  const userId = (req as AuthenticatedRequest).userId;

  const comment = await updateIssueComment(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    commentId,
    parsed.data,
  );

  res.status(200).json({
    success: true,
    data: { comment },
  });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const commentId = getCommentId(req);
  const userId = (req as AuthenticatedRequest).userId;

  await deleteIssueComment(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    commentId,
  );

  res.status(200).json({
    success: true,
    data: {
      deleted: true,
    },
  });
};
