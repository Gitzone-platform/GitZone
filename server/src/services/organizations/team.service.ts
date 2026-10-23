import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import type {
  CreateTeamInput,
  UpdateTeamInput,
} from '../../validations/organizations/team.validation.js';

export const createTeam = async (
  organizationSlug: string,
  actorId: string,
  input: CreateTeamInput,
) => {
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true },
  });

  if (!organization) {
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

  if (!membership || membership.role !== 'OWNER') {
    throw new AppError(
      'Organization owner permission required',
      403,
      'ORGANIZATION_OWNER_REQUIRED',
    );
  }

  try {
    return await prisma.team.create({
      data: {
        organizationId: organization.id,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new AppError(
        'A team with this name or slug already exists in the organization',
        409,
        'TEAM_ALREADY_EXISTS',
      );
    }

    throw error;
  }
};

export const updateTeam = async (
  organizationSlug: string,
  teamId: string,
  actorId: string,
  input: UpdateTeamInput,
) => {
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true },
  });

  if (!organization) {
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

  if (!membership || membership.role !== 'OWNER') {
    throw new AppError(
      'Organization owner permission required',
      403,
      'ORGANIZATION_OWNER_REQUIRED',
    );
  }

  const existingTeam = await prisma.team.findFirst({
    where: {
      id: teamId,
      organizationId: organization.id,
    },
    select: { id: true },
  });

  if (!existingTeam) {
    throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
  }

  const data: {
    name?: string;
    slug?: string;
    description?: string | null;
  } = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.description !== undefined) data.description = input.description;

  try {
    return await prisma.team.update({
      where: { id: existingTeam.id },
      data,
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'P2002') {
        throw new AppError(
          'A team with this name or slug already exists in the organization',
          409,
          'TEAM_ALREADY_EXISTS',
        );
      }

      if (error.code === 'P2025') {
        throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
      }
    }

    throw error;
  }
};

export const deleteTeam = async (
  organizationSlug: string,
  teamId: string,
  actorId: string,
): Promise<{ id: string }> => {
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true },
  });

  if (!organization) {
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

  if (!membership || membership.role !== 'OWNER') {
    throw new AppError(
      'Organization owner permission required',
      403,
      'ORGANIZATION_OWNER_REQUIRED',
    );
  }

  const existingTeam = await prisma.team.findFirst({
    where: {
      id: teamId,
      organizationId: organization.id,
    },
    select: { id: true },
  });

  if (!existingTeam) {
    throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
  }

  try {
    return await prisma.team.delete({
      where: { id: existingTeam.id },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'P2025') {
        throw new AppError('Team not found', 404, 'TEAM_NOT_FOUND');
      }
    }

    throw error;
  }
};
