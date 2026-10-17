import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';

export type RepositoryTransferStatus = 'PENDING' | 'MOVING' | 'MOVED' | 'COMPLETED' | 'FAILED';

export type CreateRepositoryTransferInput = {
  repositoryId: string;
  sourceOwnerId: string;
  sourceUsername: string;
  targetOrgId: string;
  targetOrgSlug: string;
  repositoryName: string;
};

/**
 * Create a durable transfer record before filesystem operations.
 *
 * The database unique constraint on repositoryId prevents two
 * simultaneous transfer journals for the same repository.
 */
export const createRepositoryTransferJournal = async (input: CreateRepositoryTransferInput) => {
  const repository = await prisma.repository.findUnique({
    where: { id: input.repositoryId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      organizationId: true,
      owner: {
        select: { username: true },
      },
    },
  });

  if (
    !repository ||
    repository.ownerId !== input.sourceOwnerId ||
    repository.organizationId !== null ||
    repository.name !== input.repositoryName ||
    repository.owner?.username !== input.sourceUsername
  ) {
    throw new AppError(
      'Repository is not eligible for transfer',
      409,
      'REPOSITORY_TRANSFER_SOURCE_INVALID',
    );
  }

  const organization = await prisma.organization.findUnique({
    where: { id: input.targetOrgId },
    select: {
      id: true,
      slug: true,
    },
  });

  if (!organization || organization.slug !== input.targetOrgSlug) {
    throw new AppError(
      'Transfer destination organization not found',
      404,
      'REPOSITORY_TRANSFER_ORGANIZATION_NOT_FOUND',
    );
  }

  const existingDestination = await prisma.repository.findUnique({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: input.repositoryName,
      },
    },
    select: { id: true },
  });

  if (existingDestination) {
    throw new AppError(
      'Repository already exists in destination organization',
      409,
      'REPOSITORY_TRANSFER_DESTINATION_EXISTS',
    );
  }

  const existingJournal = await prisma.repositoryTransfer.findUnique({
    where: { repositoryId: input.repositoryId },
    select: { id: true },
  });

  if (existingJournal) {
    throw new AppError(
      'Repository already has a transfer journal',
      409,
      'REPOSITORY_TRANSFER_ALREADY_EXISTS',
    );
  }

  return prisma.repositoryTransfer.create({
    data: {
      repositoryId: input.repositoryId,
      sourceOwnerId: input.sourceOwnerId,
      sourceUsername: input.sourceUsername,
      targetOrgId: input.targetOrgId,
      targetOrgSlug: input.targetOrgSlug,
      repositoryName: input.repositoryName,
      status: 'PENDING',
    },
  });
};

/**
 * Read transfer state for recovery and diagnostics.
 */
export const getRepositoryTransferJournal = async (repositoryId: string) =>
  prisma.repositoryTransfer.findUnique({
    where: { repositoryId },
  });

/**
 * Recovery must process unfinished transfers.
 *
 * This function only discovers them; it does not mutate Git data.
 */
export const listUnfinishedRepositoryTransfers = async () =>
  prisma.repositoryTransfer.findMany({
    where: {
      status: {
        in: ['PENDING', 'MOVING', 'MOVED'],
      },
    },
    orderBy: { createdAt: 'asc' },
  });
