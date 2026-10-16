import { z } from 'zod';
import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { AppError } from '../../errors/app.error.js';
import {
  createOrganization,
  getOrganizationProfile,
  listOrganizationMembers,
  listOrganizationOwners,
  leaveOrganization,
  removeOrganizationMember,
  transferOrganizationOwnership,
  updateOrganizationProfile,
} from '../../services/organizations/organization.service.js';
import {
  createOrganizationSchema,
  organizationSlugSchema,
  updateOrganizationProfileSchema,
} from '../../validations/organizations/organization.validation.js';

export const create = async (req: Request, res: Response): Promise<void> => {
  const parsed = createOrganizationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid organization data', 400, 'INVALID_ORGANIZATION_DATA');
  }
  const userId = (req as AuthenticatedRequest).userId;
  const organization = await createOrganization(userId, parsed.data);
  res.status(201).json({ success: true, data: { organization } });
};

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  const parsed = organizationSlugSchema.safeParse(req.params.slug);

  if (!parsed.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const userId = (req as OptionalAuthenticatedRequest).userId;

  const organization = await getOrganizationProfile(parsed.data, userId);

  res.status(200).json({
    success: true,
    data: { organization },
  });
};
export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);
  const input = updateOrganizationProfileSchema.safeParse(req.body);

  if (!slug.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  if (!input.success) {
    throw new AppError(
      'Invalid organization profile data',
      400,
      'INVALID_ORGANIZATION_PROFILE_DATA',
    );
  }

  const userId = (req as AuthenticatedRequest).userId;

  const organization = await updateOrganizationProfile(slug.data, userId, input.data);

  res.status(200).json({
    success: true,
    data: { organization },
  });
};

export const getOwners = async (req: Request, res: Response): Promise<void> => {
  const parsed = organizationSlugSchema.safeParse(req.params.slug);

  if (!parsed.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const userId = (req as OptionalAuthenticatedRequest).userId;

  const owners = await listOrganizationOwners(parsed.data, userId);
  res.status(200).json({
    success: true,
    data: { owners },
  });
};

export const getMembers = async (req: Request, res: Response): Promise<void> => {
  const parsed = organizationSlugSchema.safeParse(req.params.slug);

  if (!parsed.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const userId = (req as OptionalAuthenticatedRequest).userId;

  const members = await listOrganizationMembers(parsed.data, userId);

  res.status(200).json({
    success: true,
    data: { members },
  });
};

export const removeMember = async (req: Request, res: Response): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);

  if (!slug.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const targetUserId = req.params.userId;

  if (
    typeof targetUserId !== 'string' ||
    targetUserId.length === 0 ||
    targetUserId.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(targetUserId)
  ) {
    throw new AppError('Invalid organization member ID', 400, 'INVALID_ORGANIZATION_MEMBER_ID');
  }

  const actorId = (req as AuthenticatedRequest).userId;

  const result = await removeOrganizationMember(slug.data, actorId, targetUserId);

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const leave = async (req: Request, res: Response): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);

  if (!slug.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const actorId = (req as AuthenticatedRequest).userId;
  const result = await leaveOrganization(slug.data, actorId);

  res.status(200).json({ success: true, data: result });
};

export const transferOwnership = async (req: Request, res: Response): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);

  if (!slug.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const body = z
    .object({
      targetUserId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9_-]+$/),
    })
    .strict()
    .safeParse(req.body);

  if (!body.success) {
    throw new AppError(
      'Invalid ownership transfer request',
      400,
      'INVALID_ORGANIZATION_OWNERSHIP_TRANSFER',
    );
  }

  const actorId = (req as AuthenticatedRequest).userId;

  const result = await transferOrganizationOwnership(slug.data, actorId, body.data.targetUserId);

  res.status(200).json({ success: true, data: result });
};
