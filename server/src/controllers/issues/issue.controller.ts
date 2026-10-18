import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';

import {
  createIssue,
  listIssues,
  getIssue,
  updateIssue,
} from '../../services/issues/issue.service.js';
import {
  createIssueSchema,
  listIssuesQuerySchema,
  issueNumberSchema,
  updateIssueSchema,
} from '../../validations/issues/issue.validation.js';

export const create = async (req: Request, res: Response): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;

  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  const parsed = createIssueSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid issue data', 400, 'INVALID_ISSUE_DATA');
  }

  const issue = await createIssue(authenticatedReq.userId, username, name, parsed.data);

  res.status(201).json({
    success: true,
    data: {
      issue,
    },
  });
};

export const list = async (req: Request, res: Response): Promise<void> => {
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  const parsed = listIssuesQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError('Invalid issue query', 400, 'INVALID_ISSUE_QUERY');
  }

  const userId = (req as OptionalAuthenticatedRequest).userId;
  const result = await listIssues(username, name, userId, parsed.data);

  res.status(200).json({ success: true, data: result });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const { username, name } = req.params;
  const parsed = issueNumberSchema.safeParse(req.params.number);

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  if (!parsed.success) {
    throw new AppError('Invalid issue number', 400, 'INVALID_ISSUE_NUMBER');
  }

  const userId = (req as OptionalAuthenticatedRequest).userId;
  const issue = await getIssue(username, name, parsed.data, userId);

  res.status(200).json({ success: true, data: { issue } });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const { username, name } = req.params;
  const number = issueNumberSchema.safeParse(req.params.number);
  const body = updateIssueSchema.safeParse(req.body);

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  if (!number.success) {
    throw new AppError('Invalid issue number', 400, 'INVALID_ISSUE_NUMBER');
  }

  if (!body.success) {
    throw new AppError('Invalid issue update', 400, 'INVALID_ISSUE_UPDATE');
  }

  const userId = (req as AuthenticatedRequest).userId;
  const issue = await updateIssue(userId, username, name, number.data, body.data);

  res.status(200).json({ success: true, data: { issue } });
};
