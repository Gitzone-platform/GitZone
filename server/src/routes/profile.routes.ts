import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { optionalAuthMiddleware } from '../middleware/optional-auth.middleware.js';
import { getProfileStarredRepositories } from '../controllers/profiles/profile-starred.controller.js';
import { uploadAvatar } from '../middleware/avatar-upload.middleware.js';
import { uploadProfileAvatar } from '../controllers/profiles/avatar.controller.js';
import { getProfileAvatar } from '../controllers/profiles/avatar-read.controller.js';

import {
  getProfile,
  getProfileActivity,
  getProfileContributions,
  getProfileRepositories,
  updateProfile,
} from '../controllers/profiles/profile.controller.js';

const router = Router();

router.get('/avatars/:filename', getProfileAvatar);
router.patch('/me/avatar', authMiddleware, uploadAvatar, uploadProfileAvatar);
router.patch('/me', authMiddleware, updateProfile);

router.get('/:username/starred', optionalAuthMiddleware, getProfileStarredRepositories);
router.get('/:username/repositories', getProfileRepositories);
router.get('/:username/activity', getProfileActivity);
router.get('/:username/contributions', getProfileContributions);

router.get('/:username', getProfile);

export default router;
