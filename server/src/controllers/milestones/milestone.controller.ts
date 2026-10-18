import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';

import {
  createMilestone,
  listMilestones,
  getMilestone,
  updateMilestone,
  deleteMilestone,
} from '../../services/milestones/milestone.service.js';

import {
  createMilestoneSchema,
  updateMilestoneSchema,
  listMilestonesQuerySchema,
  milestoneIdSchema,
} from '../../validations/milestones/milestone.validation.js';

const getRepositoryParams = (req: Request) => {
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string' || !username || !name) {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  return { username, repositoryName: name };
};

const getMilestoneParams = (req: Request) => {
  const repository = getRepositoryParams(req);
  const parsed = milestoneIdSchema.safeParse(req.params.milestoneId);

  if (!parsed.success) {
    throw new AppError('Invalid milestone ID', 400, 'INVALID_MILESTONE_ID');
  }

  return {
    ...repository,
    milestoneId: parsed.data,
  };
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const params = getRepositoryParams(req);
  const parsed = createMilestoneSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid milestone data', 400, 'INVALID_MILESTONE_DATA');
  }

  const userId = (req as AuthenticatedRequest).userId;

  const milestone = await createMilestone(
    userId,
    params.username,
    params.repositoryName,
    parsed.data,
  );

  res.status(201).json({
    success: true,
    data: { milestone },
  });
};

export const list = async (req: Request, res: Response): Promise<void> => {
  const params = getRepositoryParams(req);
  const parsed = listMilestonesQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    throw new AppError('Invalid milestone query', 400, 'INVALID_MILESTONE_QUERY');
  }

  const userId = (req as OptionalAuthenticatedRequest).userId;

  const result = await listMilestones(params.username, params.repositoryName, parsed.data, userId);

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const params = getMilestoneParams(req);
  const userId = (req as OptionalAuthenticatedRequest).userId;

  const milestone = await getMilestone(
    params.username,
    params.repositoryName,
    params.milestoneId,
    userId,
  );

  res.status(200).json({
    success: true,
    data: { milestone },
  });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const params = getMilestoneParams(req);
  const parsed = updateMilestoneSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid milestone update', 400, 'INVALID_MILESTONE_UPDATE');
  }

  const userId = (req as AuthenticatedRequest).userId;

  const milestone = await updateMilestone(
    userId,
    params.username,
    params.repositoryName,
    params.milestoneId,
    parsed.data,
  );

  res.status(200).json({
    success: true,
    data: { milestone },
  });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const params = getMilestoneParams(req);
  const userId = (req as AuthenticatedRequest).userId;

  await deleteMilestone(userId, params.username, params.repositoryName, params.milestoneId);

  res.status(204).send();
};
