import { createOrganizationRepositoryController } from '../controllers/organizations/organization-repository.controller.js';
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  create,
  getMembers,
  getOwners,
  getProfile,
  leave,
  removeMember,
  transferOwnership,
  updateProfile,
} from '../controllers/organizations/organization.controller.js';
import { optionalAuthMiddleware } from '../middleware/optional-auth.middleware.js';
import {
  acceptInvitation,
  inviteMember,
} from '../controllers/organizations/organization-invitation.controller.js';

import {
  createTeamController,
  updateTeamController,
  deleteTeamController,
} from '../controllers/organizations/team.controller.js';

const router = Router();
router.post('/', authMiddleware, create);
router.post('/invitations/:invitationId/accept', authMiddleware, acceptInvitation);

router.post('/:slug/repositories', authMiddleware, createOrganizationRepositoryController);
router.post('/:slug/teams', authMiddleware, createTeamController);
router.patch('/:slug/teams/:teamId', authMiddleware, updateTeamController);
router.delete('/:slug/teams/:teamId', authMiddleware, deleteTeamController);
router.post('/:slug/invitations', authMiddleware, inviteMember);
router.get('/:slug/owners', optionalAuthMiddleware, getOwners);
router.post('/:slug/leave', authMiddleware, leave);
router.post('/:slug/ownership/transfer', authMiddleware, transferOwnership);
router.delete('/:slug/members/:userId', authMiddleware, removeMember);
router.get('/:slug/members', optionalAuthMiddleware, getMembers);
router.get('/:slug', optionalAuthMiddleware, getProfile);
router.patch('/:slug', authMiddleware, updateProfile);
export default router;
