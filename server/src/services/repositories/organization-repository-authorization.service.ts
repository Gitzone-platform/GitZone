import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';

export type OrganizationRepositoryAccessType = 'READ' | 'WRITE';

export const authorizeOrganizationRepositoryAccess = async (
  repositoryId: string,
  accessType: OrganizationRepositoryAccessType,
  userId?: string,
) => {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      organizationId: true,
      isPrivate: true,
      organization: {
        select: {
          id: true,
          slug: true,
        },
      },
      collaborators: userId
        ? {
            where: { userId },
            select: { permission: true },
            take: 1,
          }
        : false,
    },
  });

  if (!repository || !repository.organizationId || !repository.organization) {
    throw new AppError(
      'Organization repository not found',
      404,
      'ORGANIZATION_REPOSITORY_NOT_FOUND',
    );
  }

  const collaborator = userId ? repository.collaborators[0] : undefined;

  const membership = userId
    ? await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: repository.organizationId,
            userId,
          },
        },
        select: { role: true },
      })
    : null;

  let permission: 'OWNER' | 'MEMBER' | 'READ' | 'WRITE' | 'PUBLIC' | null = null;

  if (membership?.role === 'OWNER') {
    permission = 'OWNER';
  } else if (collaborator?.permission === 'WRITE') {
    permission = 'WRITE';
  } else if (accessType === 'READ') {
    if (membership?.role === 'MEMBER') {
      permission = 'MEMBER';
    } else if (collaborator?.permission === 'READ') {
      permission = 'READ';
    } else if (!repository.isPrivate) {
      permission = 'PUBLIC';
    }
  }

  if (!permission) {
    throw new AppError(
      'You do not have permission to access this organization repository',
      403,
      'ORGANIZATION_REPOSITORY_ACCESS_DENIED',
    );
  }

  return {
    repositoryId: repository.id,
    repositoryName: repository.name,
    organizationId: repository.organization.id,
    organizationSlug: repository.organization.slug,
    isPrivate: repository.isPrivate,
    permission,
  };
};