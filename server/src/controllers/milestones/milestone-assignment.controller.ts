import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';

import {
  assignIssueMilestone,
  assignPullRequestMilestone,
} from '../../services/milestones/milestone-assignment.service.js';

import {
  assignMilestoneSchema,
  milestoneAssignmentNumberSchema,
} from '../../validations/milestones/milestone-assignment.validation.js';

const getParams = (req: Request) => {
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string' || !username || !name) {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  const parsedNumber = milestoneAssignmentNumberSchema.safeParse(req.params.number);

  if (!parsedNumber.success) {
    throw new AppError('Invalid issue or pull request number', 400, 'INVALID_NUMBER');
  }

  return {
    username,
    repositoryName: name,
    number: parsedNumber.data,
  };
};

const getBody = (req: Request) => {
  const parsed = assignMilestoneSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid milestone assignment data', 400, 'INVALID_MILESTONE_ASSIGNMENT');
  }

  return parsed.data;
};

export const updateIssueMilestone = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const body = getBody(req);
  const userId = (req as AuthenticatedRequest).userId;

  const issue = await assignIssueMilestone(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    body.milestoneId,
  );

  res.status(200).json({
    success: true,
    data: { issue },
  });
};

export const updatePullRequestMilestone = async (req: Request, res: Response): Promise<void> => {
  const params = getParams(req);
  const body = getBody(req);
  const userId = (req as AuthenticatedRequest).userId;

  const pullRequest = await assignPullRequestMilestone(
    userId,
    params.username,
    params.repositoryName,
    params.number,
    body.milestoneId,
  );

  res.status(200).json({
    success: true,
    data: { pullRequest },
  });
};
