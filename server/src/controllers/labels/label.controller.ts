import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';

import {
  createLabel,
  listLabels,
  getLabel,
  updateLabel,
  deleteLabel,
} from '../../services/labels/label.service.js';

import {
  createLabelSchema,
  updateLabelSchema,
  labelIdSchema,
} from '../../validations/labels/label.validation.js';

const getRepositoryParams = (req: Request) => {
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string' || !username || !name) {
    throw new AppError('Invalid repository parameters', 400, 'INVALID_REPOSITORY_PARAMS');
  }

  return { username, repositoryName: name };
};

const getLabelParams = (req: Request) => {
  const repository = getRepositoryParams(req);
  const parsed = labelIdSchema.safeParse(req.params.labelId);

  if (!parsed.success) {
    throw new AppError('Invalid label ID', 400, 'INVALID_LABEL_ID');
  }

  return { ...repository, labelId: parsed.data };
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const params = getRepositoryParams(req);
  const parsed = createLabelSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid label data', 400, 'INVALID_LABEL_DATA');
  }

  const userId = (req as AuthenticatedRequest).userId;

  const label = await createLabel(userId, params.username, params.repositoryName, parsed.data);

  res.status(201).json({
    success: true,
    data: { label },
  });
};

export const list = async (req: Request, res: Response): Promise<void> => {
  const params = getRepositoryParams(req);
  const userId = (req as OptionalAuthenticatedRequest).userId;

  const labels = await listLabels(params.username, params.repositoryName, userId);

  res.status(200).json({
    success: true,
    data: { labels },
  });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const params = getLabelParams(req);
  const userId = (req as OptionalAuthenticatedRequest).userId;

  const label = await getLabel(params.username, params.repositoryName, params.labelId, userId);

  res.status(200).json({
    success: true,
    data: { label },
  });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const params = getLabelParams(req);
  const parsed = updateLabelSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid label update', 400, 'INVALID_LABEL_UPDATE');
  }

  const userId = (req as AuthenticatedRequest).userId;

  const label = await updateLabel(
    userId,
    params.username,
    params.repositoryName,
    params.labelId,
    parsed.data,
  );

  res.status(200).json({
    success: true,
    data: { label },
  });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const params = getLabelParams(req);
  const userId = (req as AuthenticatedRequest).userId;

  await deleteLabel(userId, params.username, params.repositoryName, params.labelId);

  res.status(204).send();
};
