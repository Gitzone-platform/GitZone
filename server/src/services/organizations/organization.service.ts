import type { UpdateOrganizationProfileInput } from '../../validations/organizations/organization.validation.js';
import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import type { CreateOrganizationInput } from '../../validations/organizations/organization.validation.js';

export const createOrganization = async (userId: string, input: CreateOrganizationInput) => {
  const reservedName = await prisma.namespaceEntry.findUnique({
    where: { name: input.slug.toLowerCase() },
    select: { name: true },
  });

  if (reservedName) {
    throw new AppError(
      'Organization slug already exists',
      409,
      'ORGANIZATION_ALREADY_EXISTS',
    );
  }

  try {
    return await prisma.organization.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility,
        members: {
          create: { userId, role: 'OWNER' },
        },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new AppError('Organization slug already exists', 409, 'ORGANIZATION_ALREADY_EXISTS');
    }
    throw error;
  }
};

const organizationProfileSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  avatarUrl: true,
  website: true,
  visibility: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const getOrganizationProfile = async (
  slug: string,
  userId?: string,
) => {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: {
      ...organizationProfileSelect,
      members: userId
        ? {
            where: { userId },
            select: { role: true },
            take: 1,
          }
        : false,
    },
  });

  if (!organization) {
    throw new AppError(
      'Organization not found',
      404,
      'ORGANIZATION_NOT_FOUND',
    );
  }

  if (organization.visibility === 'PRIVATE') {
    if (!userId) {
      throw new AppError(
        'Organization not found',
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    }

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      throw new AppError(
        'Organization not found',
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    }
  }

  const { members: _members, ...profile } = organization;
  void _members;

  return profile;
};

export const updateOrganizationProfile = async (
  slug: string,
  userId: string,
  input: UpdateOrganizationProfileInput,
) => {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!organization) {
    throw new AppError(
      'Organization not found',
      404,
      'ORGANIZATION_NOT_FOUND',
    );
  }

  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId,
      },
    },
    select: { role: true },
  });

  if (!membership || membership.role !== 'OWNER') {
    throw new AppError(
      'Organization owner permission required',
      403,
      'ORGANIZATION_OWNER_REQUIRED',
    );
  }

  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.avatarUrl !== undefined
      ? { avatarUrl: input.avatarUrl }
      : {}),
    ...(input.website !== undefined
      ? { website: input.website }
      : {}),
  };

  return prisma.organization.update({
    where: { id: organization.id },
    data,
    select: organizationProfileSelect,
  });
};
export const listOrganizationOwners = async (
  slug: string,
  userId?: string,
) => {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true,
      visibility: true,
    },
  });

  if (!organization) {
    throw new AppError(
      'Organization not found',
      404,
      'ORGANIZATION_NOT_FOUND',
    );
  }

  if (organization.visibility === 'PRIVATE') {
    if (!userId) {
      throw new AppError(
        'Organization not found',
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    }

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      throw new AppError(
        'Organization not found',
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    }
  }

  const owners = await prisma.organizationMember.findMany({
    where: {
      organizationId: organization.id,
      role: 'OWNER',
    },
    select: {
      user: {
        select: {
          id: true,
          username: true,
          name: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  return owners.map(({ user }) => user);
};

export const listOrganizationMembers = async (
  slug: string,
  userId?: string,
) => {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true,
      visibility: true,
    },
  });

  if (!organization) {
    throw new AppError(
      'Organization not found',
      404,
      'ORGANIZATION_NOT_FOUND',
    );
  }

  if (organization.visibility === 'PRIVATE') {
    if (!userId) {
      throw new AppError(
        'Organization not found',
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    }

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      throw new AppError(
        'Organization not found',
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    }
  }

  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId: organization.id,
    },
    select: {
      role: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          username: true,
          name: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });

  return members.map(({ user, role, createdAt }) => ({
    ...user,
    role,
    joinedAt: createdAt,
  }));
};

export const removeOrganizationMember = async (
  slug: string,
  actorId: string,
  targetUserId: string,
) => {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!organization) {
    throw new AppError(
      'Organization not found',
      404,
      'ORGANIZATION_NOT_FOUND',
    );
  }

  const actorMembership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: actorId,
      },
    },
    select: { role: true },
  });

  if (!actorMembership || actorMembership.role !== 'OWNER') {
    throw new AppError(
      'Organization owner permission required',
      403,
      'ORGANIZATION_OWNER_REQUIRED',
    );
  }

  const targetMembership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: targetUserId,
      },
    },
    select: { role: true },
  });

  if (!targetMembership) {
    throw new AppError(
      'Organization member not found',
      404,
      'ORGANIZATION_MEMBER_NOT_FOUND',
    );
  }

  if (targetMembership.role === 'OWNER') {
    throw new AppError(
      'Organization owners cannot be removed through this endpoint',
      409,
      'ORGANIZATION_OWNER_REMOVAL_FORBIDDEN',
    );
  }

  const result = await prisma.organizationMember.deleteMany({
    where: {
      organizationId: organization.id,
      userId: targetUserId,
      role: 'MEMBER',
    },
  });

  if (result.count !== 1) {
    throw new AppError(
      'Organization membership changed during removal',
      409,
      'ORGANIZATION_MEMBERSHIP_CHANGED',
    );
  }

  return {
    organizationId: organization.id,
    removedUserId: targetUserId,
  };
};
