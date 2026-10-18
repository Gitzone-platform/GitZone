import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';

import {
  addIssueLabel,
  removeIssueLabel,
  addPullRequestLabel,
  removePullRequestLabel,
} from '../../services/labels/label-assignment.service.js';

import {
  assignLabelSchema,
  labelAssignmentNumberSchema,
  labelAssignmentIdSchema,
} from '../../validations/labels/label-assignment.validation.js';

const getParams = (req: Request) => {
  const { username, name } = req.params;
  const number = labelAssignmentNumberSchema.safeParse(req.params.number);

  if (typeof username !== 'string' || typeof name !== 'string' || !username || !name) {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  if (!number.success) {
    throw new AppError(
      'Invalid issue or pull request number',
      400,
      'INVALID_LABEL_ASSIGNMENT_NUMBER',
    );
  }

  return {
    username,
    repositoryName: name,
    number: number.data,
  };
};

const getRemovalParams = (req: Request) => {
  const params = getParams(req);
  const labelId = labelAssignmentIdSchema.safeParse(req.params.labelId);

  if (!labelId.success) {
    throw new AppError('Invalid label ID', 400, 'INVALID_LABEL_ID');
  }

  return {
    ...params,
    labelId: labelId.data,
  };
};

const getAssignmentBody = (req: Request) => {
  const parsed = assignLabelSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid label assignment data', 400, 'INVALID_LABEL_ASSIGNMENT_DATA');
  }

  return parsed.data;
};

export const createIssueLabel = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const input = getAssignmentBody(req);
  const userId = (req as AuthenticatedRequest).userId;

  const label = await addIssueLabel(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    input.labelId,
  );

  res.status(201).json({
    success: true,
    data: { label },
  });
};

export const deleteIssueLabel = async (req: Request, res: Response): Promise<void> => {
  const params = getRemovalParams(req);
  const userId = (req as AuthenticatedRequest).userId;

  await removeIssueLabel(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    params.labelId,
  );

  res.status(204).send();
};

export const createPullRequestLabel = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const input = getAssignmentBody(req);
  const userId = (req as AuthenticatedRequest).userId;

  const label = await addPullRequestLabel(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    input.labelId,
  );

  res.status(201).json({
    success: true,
    data: { label },
  });
};

export const deletePullRequestLabel = async (req: Request, res: Response): Promise<void> => {
  const params = getRemovalParams(req);
  const userId = (req as AuthenticatedRequest).userId;

  await removePullRequestLabel(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    params.labelId,
  );

  res.status(204).send();
};
