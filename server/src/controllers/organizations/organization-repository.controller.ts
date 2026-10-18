import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { AppError } from '../../errors/app.error.js';
import { createOrganizationRepository } from '../../services/repositories/organization-repository-create.service.js';
import { organizationSlugSchema } from '../../validations/organizations/organization.validation.js';
import { createRepositorySchema } from '../../validations/repositories/repository.validation.js';

export const createOrganizationRepositoryController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);

  if (!slug.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const input = createRepositorySchema.safeParse(req.body);

  if (!input.success) {
    throw new AppError('Invalid repository data', 400, 'INVALID_REPOSITORY_DATA');
  }

  const actorId = (req as AuthenticatedRequest).userId;

  const repository = await createOrganizationRepository(slug.data, actorId, input.data);

  res.status(201).json({
    success: true,
    data: { repository },
  });
};
