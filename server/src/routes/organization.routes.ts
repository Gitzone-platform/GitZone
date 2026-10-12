import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { create, getProfile, updateProfile } from '../controllers/organizations/organization.controller.js';
import { optionalAuthMiddleware } from '../middleware/optional-auth.middleware.js';

const router = Router();
router.post('/', authMiddleware, create);
router.get('/:slug', optionalAuthMiddleware, getProfile);
router.patch('/:slug', authMiddleware, updateProfile);
export default router;
