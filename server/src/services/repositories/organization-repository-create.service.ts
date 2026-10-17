import prisma from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../errors/app.error.js';
import { createOrganizationGitRepository } from '../git/git-repository.service.js';
import { withGitNamespaceWriteLock } from '../git/git-user-lock.service.js';
import type { CreateRepositoryInput } from '../../validations/repositories/repository.validation.js';

export const createOrganizationRepository = async (
  slug: string,
  actorId: string,
  input: CreateRepositoryInput,
) => {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!organization) {
    throw new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND');
  }

  return withGitNamespaceWriteLock({ type: 'ORGANIZATION', id: organization.id }, async () => {
    const currentOrganization = await prisma.organization.findUnique({
      where: { id: organization.id },
      select: { id: true, slug: true },
    });

    if (!currentOrganization || currentOrganization.slug !== slug) {
      throw new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND');
    }

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: actorId,
        },
      },
      select: { role: true },
    });

    if (membership?.role !== 'OWNER') {
      throw new AppError(
        'Organization owner permission required',
        403,
        'ORGANIZATION_OWNER_REQUIRED',
      );
    }

    const existingRepository = await prisma.repository.findUnique({
      where: {
        organizationId_name: {
          organizationId: organization.id,
          name: input.name,
        },
      },
      select: { id: true },
    });

    if (existingRepository) {
      throw new AppError(
        'Repository with this name already exists',
        409,
        'REPOSITORY_ALREADY_EXISTS',
      );
    }

    let repository;

    try {
      repository = await prisma.repository.create({
        data: {
          ownerId: null,
          organizationId: organization.id,
          name: input.name,
          description: input.description ?? null,
          isPrivate: input.isPrivate ?? false,
        },
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        throw new AppError(
          'Repository with this name already exists',
          409,
          'REPOSITORY_ALREADY_EXISTS',
        );
      }

      throw error;
    }

    try {
      await createOrganizationGitRepository(currentOrganization.slug, repository.name);
    } catch (error) {
      try {
        await prisma.repository.delete({
          where: { id: repository.id },
        });
      } catch (rollbackError) {
        logger.error(
          {
            err: rollbackError,
            originalError: error,
            organizationId: organization.id,
            repositoryId: repository.id,
            repositoryName: repository.name,
          },
          'Organization repository creation rollback failed',
        );

        throw new AppError(
          'Organization repository creation rollback failed',
          500,
          'ORGANIZATION_REPOSITORY_CREATE_ROLLBACK_FAILED',
        );
      }

      throw error;
    }

    return {
      id: repository.id,
      ownerId: null,
      organizationId: organization.id,
      name: repository.name,
      description: repository.description,
      isPrivate: repository.isPrivate,
      defaultBranch: repository.defaultBranch,
      createdAt: repository.createdAt,
      updatedAt: repository.updatedAt,
    };
  });
};
