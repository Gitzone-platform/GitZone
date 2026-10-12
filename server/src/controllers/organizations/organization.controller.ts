import type { OptionalAuthenticatedRequest } from '../../middleware/optional-auth.middleware.js';import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { AppError } from '../../errors/app.error.js';
import { createOrganization, getOrganizationProfile, updateOrganizationProfile } from '../../services/organizations/organization.service.js';
import { createOrganizationSchema, organizationSlugSchema, updateOrganizationProfileSchema } from '../../validations/organizations/organization.validation.js';

export const create = async (req: Request, res: Response): Promise<void> => {
  const parsed = createOrganizationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid organization data', 400, 'INVALID_ORGANIZATION_DATA');
  }
  const userId = (req as AuthenticatedRequest).userId;
  const organization = await createOrganization(userId, parsed.data);
  res.status(201).json({ success: true, data: { organization } });
};

export const getProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const parsed = organizationSlugSchema.safeParse(req.params.slug);

  if (!parsed.success) {
    throw new AppError(
      'Invalid organization slug',
      400,
      'INVALID_ORGANIZATION_SLUG',
    );
  }

  const userId = (req as OptionalAuthenticatedRequest).userId;

  const organization = await getOrganizationProfile(parsed.data, userId);

  res.status(200).json({
    success: true,
    data: { organization },
  });
};

export const updateProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);
  const input = updateOrganizationProfileSchema.safeParse(req.body);

  if (!slug.success) {
    throw new AppError(
      'Invalid organization slug',
      400,
      'INVALID_ORGANIZATION_SLUG',
    );
  }

  if (!input.success) {
    throw new AppError(
      'Invalid organization profile data',
      400,
      'INVALID_ORGANIZATION_PROFILE_DATA',
    );
  }

  const userId = (req as AuthenticatedRequest).userId;

  const organization = await updateOrganizationProfile(
    slug.data,
    userId,
    input.data,
  );

  res.status(200).json({
    success: true,
    data: { organization },
  });
};
