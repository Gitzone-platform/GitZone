import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';

import {
  addIssueAssignee,
  listIssueAssignees,
  removeIssueAssignee,
} from '../../services/issues/issue-assignee.service.js';

import { issueNumberSchema } from '../../validations/issues/issue.validation.js';

import {
  addIssueAssigneeSchema,
  issueAssigneeUsernameSchema,
} from '../../validations/issues/issue-assignee.validation.js';

const getParams = (req: Request) => {
  const { username, name } = req.params;
  const number = issueNumberSchema.safeParse(req.params.number);

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  if (!number.success) {
    throw new AppError('Invalid issue number', 400, 'INVALID_ISSUE_NUMBER');
  }

  return {
    username,
    repositoryName: name,
    number: number.data,
  };
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const parsed = addIssueAssigneeSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid issue assignee data', 400, 'INVALID_ISSUE_ASSIGNEE_DATA');
  }

  const userId = (req as AuthenticatedRequest).userId;

  const assignee = await addIssueAssignee(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    parsed.data.username,
  );

  res.status(201).json({
    success: true,
    data: { assignee },
  });
};

export const list = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const userId = (req as OptionalAuthenticatedRequest).userId;

  const assignees = await listIssueAssignees(
    params.username,
    params.repositoryName,
    params.number,
    userId,
  );

  res.status(200).json({
    success: true,
    data: { assignees },
  });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);

  const parsed = issueAssigneeUsernameSchema.safeParse(req.params.assigneeUsername);

  if (!parsed.success) {
    throw new AppError('Invalid assignee username', 400, 'INVALID_ISSUE_ASSIGNEE_USERNAME');
  }

  const userId = (req as AuthenticatedRequest).userId;

  await removeIssueAssignee(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    parsed.data,
  );

  res.status(200).json({
    success: true,
    data: { deleted: true },
  });
};
