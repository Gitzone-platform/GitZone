import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { AppError } from '../../errors/app.error.js';
import { createTeam, updateTeam, deleteTeam } from '../../services/organizations/team.service.js';
import { organizationSlugSchema } from '../../validations/organizations/organization.validation.js';
import {
  createTeamSchema,
  updateTeamSchema,
} from '../../validations/organizations/team.validation.js';

export const createTeamController = async (req: Request, res: Response): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);

  if (!slug.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const input = createTeamSchema.safeParse(req.body);

  if (!input.success) {
    throw new AppError('Invalid team data', 400, 'INVALID_TEAM_DATA');
  }

  const actorId = (req as AuthenticatedRequest).userId;
  const team = await createTeam(slug.data, actorId, input.data);

  res.status(201).json({
    success: true,
    data: { team },
  });
};

export const updateTeamController = async (req: Request, res: Response): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);

  if (!slug.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const teamId = typeof req.params.teamId === 'string' ? req.params.teamId.trim() : '';

  if (!teamId || teamId.length > 64) {
    throw new AppError('Invalid team ID', 400, 'INVALID_TEAM_ID');
  }

  const input = updateTeamSchema.safeParse(req.body);

  if (!input.success) {
    throw new AppError('Invalid team data', 400, 'INVALID_TEAM_DATA');
  }

  const actorId = (req as AuthenticatedRequest).userId;
  const team = await updateTeam(slug.data, teamId, actorId, input.data);

  res.status(200).json({
    success: true,
    data: { team },
  });
};

export const deleteTeamController = async (req: Request, res: Response): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);

  if (!slug.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const teamId = typeof req.params.teamId === 'string' ? req.params.teamId.trim() : '';

  if (!teamId || teamId.length > 64) {
    throw new AppError('Invalid team ID', 400, 'INVALID_TEAM_ID');
  }

  const actorId = (req as AuthenticatedRequest).userId;

  const result = await deleteTeam(slug.data, teamId, actorId);

  res.status(200).json({
    success: true,
    data: { team: result },
  });
};
