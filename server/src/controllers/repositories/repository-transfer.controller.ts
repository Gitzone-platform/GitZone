import type { Request, Response } from 'express';
import { z } from 'zod';

import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { prepareRepositoryTransferOrchestration } from '../../services/repositories/repository-transfer-orchestrator.service.js';

const transferSchema = z.object({
  organizationSlug: z.string().min(1).max(100),
}).strict();

export const transferRepositoryToOrganization = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const authenticatedReq = req as AuthenticatedRequest;
  const { username, name } = req.params;

  if (typeof username !== 'string' || typeof name !== 'string') {
    throw new AppError(
      'Invalid repository parameters',
      400,
      'INVALID_REPOSITORY_PARAMS',
    );
  }

  const parsed = transferSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(
      'Invalid repository transfer data',
      400,
      'INVALID_REPOSITORY_TRANSFER_DATA',
    );
  }

  const repository = await prisma.repository.findFirst({
    where: {
      name,
      owner: { username },
      organizationId: null,
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      owner: { select: { username: true } },
    },
  });

  if (!repository || !repository.ownerId || !repository.owner) {
    throw new AppError(
      'Repository not found',
      404,
      'REPOSITORY_NOT_FOUND',
    );
  }

  if (repository.ownerId !== authenticatedReq.userId) {
    throw new AppError(
      'Only the repository owner can transfer it',
      403,
      'REPOSITORY_TRANSFER_NOT_OWNER',
    );
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: parsed.data.organizationSlug },
    select: { id: true, slug: true },
  });

  if (!organization) {
    throw new AppError(
      'Organization not found',
      404,
      'ORGANIZATION_NOT_FOUND',
    );
  }

  const result = await prepareRepositoryTransferOrchestration({
    repositoryId: repository.id,
    actorId: authenticatedReq.userId,
    sourceOwnerId: repository.ownerId,
    sourceUsername: repository.owner.username,
    targetOrgId: organization.id,
    targetOrgSlug: organization.slug,
    repositoryName: repository.name,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
};
