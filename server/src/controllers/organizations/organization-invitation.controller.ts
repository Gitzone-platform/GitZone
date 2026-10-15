import type { Request, Response } from 'express';

import { AppError } from '../../errors/app.error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import {
  acceptOrganizationInvitation,
  inviteOrganizationMember,
} from '../../services/organizations/organization-invitation.service.js';
import {
  inviteOrganizationMemberSchema,
  organizationSlugSchema,
} from '../../validations/organizations/organization.validation.js';

export const inviteMember = async (req: Request, res: Response): Promise<void> => {
  const slug = organizationSlugSchema.safeParse(req.params.slug);

  if (!slug.success) {
    throw new AppError('Invalid organization slug', 400, 'INVALID_ORGANIZATION_SLUG');
  }

  const input = inviteOrganizationMemberSchema.safeParse(req.body);

  if (!input.success) {
    throw new AppError(
      'Invalid organization invitation data',
      400,
      'INVALID_ORGANIZATION_INVITATION_DATA',
    );
  }

  const userId = (req as AuthenticatedRequest).userId;

  const invitation = await inviteOrganizationMember(slug.data, userId, input.data);

  res.status(201).json({
    success: true,
    data: { invitation },
  });
};
export const acceptInvitation = async (req: Request, res: Response): Promise<void> => {
  const invitationId = req.params.invitationId;

  if (
    typeof invitationId !== 'string' ||
    invitationId.length === 0 ||
    invitationId.length > 128 ||
    !/^[a-zA-Z0-9_-]+$/.test(invitationId)
  ) {
    throw new AppError(
      'Invalid organization invitation ID',
      400,
      'INVALID_ORGANIZATION_INVITATION_ID',
    );
  }

  const userId = (req as AuthenticatedRequest).userId;

  const result = await acceptOrganizationInvitation(invitationId, userId);

  res.status(200).json({
    success: true,
    data: result,
  });
};
