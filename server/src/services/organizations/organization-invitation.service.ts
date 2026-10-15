import prisma from '../../config/prisma.js';
import { AppError } from '../../errors/app.error.js';
import type { InviteOrganizationMemberInput } from '../../validations/organizations/organization.validation.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const invitationSelect = {
  id: true,
  organizationId: true,
  inviteeId: true,
  invitedById: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const inviteOrganizationMember = async (
  slug: string,
  actorId: string,
  input: InviteOrganizationMemberInput,
) => {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!organization) {
    throw new AppError('Organization not found', 404, 'ORGANIZATION_NOT_FOUND');
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

  const invitee = await prisma.user.findFirst({
    where: {
      username: {
        equals: input.username,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
    },
  });

  if (!invitee) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const existingMember = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: invitee.id,
      },
    },
    select: { id: true },
  });

  if (existingMember) {
    throw new AppError(
      'User is already an organization member',
      409,
      'ORGANIZATION_MEMBER_ALREADY_EXISTS',
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  const pendingInvitation = await prisma.organizationInvitation.findFirst({
    where: {
      organizationId: organization.id,
      inviteeId: invitee.id,
      status: 'PENDING',
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  if (pendingInvitation && pendingInvitation.expiresAt > now) {
    throw new AppError(
      'A pending invitation already exists',
      409,
      'ORGANIZATION_INVITATION_ALREADY_EXISTS',
    );
  }

  try {
    const invitation = pendingInvitation
      ? await prisma.organizationInvitation.update({
          where: {
            id: pendingInvitation.id,
            status: 'PENDING',
            expiresAt: { lte: now },
          },
          data: {
            invitedById: actorId,
            expiresAt,
          },
          select: invitationSelect,
        })
      : await prisma.organizationInvitation.create({
          data: {
            organizationId: organization.id,
            inviteeId: invitee.id,
            invitedById: actorId,
            status: 'PENDING',
            expiresAt,
          },
          select: invitationSelect,
        });

    return {
      ...invitation,
      invitee,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'P2002' || error.code === 'P2025')
    ) {
      throw new AppError(
        'A pending invitation already exists',
        409,
        'ORGANIZATION_INVITATION_ALREADY_EXISTS',
      );
    }

    throw error;
  }
};
export const acceptOrganizationInvitation = async (invitationId: string, actorId: string) => {
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      organizationId: true,
      inviteeId: true,
      status: true,
      expiresAt: true,
    },
  });

  if (!invitation || invitation.inviteeId !== actorId) {
    throw new AppError(
      'Organization invitation not found',
      404,
      'ORGANIZATION_INVITATION_NOT_FOUND',
    );
  }

  if (invitation.status !== 'PENDING') {
    throw new AppError(
      'Organization invitation is no longer pending',
      409,
      'ORGANIZATION_INVITATION_NOT_PENDING',
    );
  }

  const now = new Date();

  if (invitation.expiresAt <= now) {
    throw new AppError(
      'Organization invitation has expired',
      410,
      'ORGANIZATION_INVITATION_EXPIRED',
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.organizationInvitation.updateMany({
        where: {
          id: invitationId,
          inviteeId: actorId,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        data: { status: 'ACCEPTED' },
      });

      if (claimed.count !== 1) {
        throw new AppError(
          'Organization invitation is no longer available',
          409,
          'ORGANIZATION_INVITATION_NOT_PENDING',
        );
      }

      const membership = await tx.organizationMember.create({
        data: {
          organizationId: invitation.organizationId,
          userId: actorId,
          role: 'MEMBER',
        },
        select: {
          id: true,
          organizationId: true,
          userId: true,
          role: true,
          createdAt: true,
        },
      });

      return {
        invitationId,
        status: 'ACCEPTED' as const,
        membership,
      };
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      throw new AppError(
        'User is already an organization member',
        409,
        'ORGANIZATION_MEMBER_ALREADY_EXISTS',
      );
    }

    throw error;
  }
};
