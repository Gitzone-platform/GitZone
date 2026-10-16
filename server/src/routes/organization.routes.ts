import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { create, getMembers, getOwners, getProfile, leave, removeMember, transferOwnership, updateProfile } from '../controllers/organizations/organization.controller.js';
import { optionalAuthMiddleware } from '../middleware/optional-auth.middleware.js';
import { acceptInvitation, inviteMember } from '../controllers/organizations/organization-invitation.controller.js';

const router = Router();
router.post('/', authMiddleware, create);
router.post('/invitations/:invitationId/accept', authMiddleware, acceptInvitation);

router.post('/:slug/invitations', authMiddleware, inviteMember);
router.get('/:slug/owners', optionalAuthMiddleware, getOwners);
router.post('/:slug/leave', authMiddleware, leave);
router.post('/:slug/ownership/transfer', authMiddleware, transferOwnership);
router.delete('/:slug/members/:userId', authMiddleware, removeMember);
router.get('/:slug/members', optionalAuthMiddleware, getMembers);
router.get('/:slug', optionalAuthMiddleware, getProfile);
router.patch('/:slug', authMiddleware, updateProfile);
export default router;
