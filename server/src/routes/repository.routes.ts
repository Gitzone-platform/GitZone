import {
  updateIssueMilestone,
  updatePullRequestMilestone,
} from '../controllers/milestones/milestone-assignment.controller.js';
import {
  createIssueLabel,
  deleteIssueLabel,
  createPullRequestLabel,
  deletePullRequestLabel,
} from '../controllers/labels/label-assignment.controller.js';
import {
  create as addIssueAssignee,
  list as listIssueAssignees,
  remove as removeIssueAssignee,
} from '../controllers/issues/issue-assignee.controller.js';
import {
  create as createIssueComment,
  list as listIssueComments,
  update as updateIssueComment,
  remove as deleteIssueComment,
} from '../controllers/issues/issue-comment.controller.js';
import {
  create as createIssue,
  list as listIssues,
  getOne as getIssue,
  update as updateIssue,
} from '../controllers/issues/issue.controller.js';
import { Router } from 'express';
import {
  create as createPullRequest,
  getOne as getPullRequest,
  list as listPullRequests,
  update as updatePullRequest,
  getCommits as getPullRequestCommits,
  getDiff as getPullRequestDiff,
  getMergeability as getPullRequestMergeability,
  merge as mergePullRequest,
} from '../controllers/pull-requests/pull-request.controller.js';

import {
  createConversationComment as createPullRequestConversationComment,
  createGeneralComment as createPullRequestGeneralComment,
  createInlineComment as createPullRequestInlineComment,
  deleteComment as deletePullRequestComment,
  editComment as editPullRequestComment,
  getReviewState as getPullRequestReviewState,
  listConversations as listPullRequestConversations,
  listReviews as listPullRequestReviews,
  reopenConversation as reopenPullRequestConversation,
  resolveConversation as resolvePullRequestConversation,
  submitReview as submitPullRequestReview,
} from '../controllers/pull-requests/pull-request-review.controller.js';

import {
  getStarCount,
  star,
  unstar,
} from '../controllers/repositories/repository-star.controller.js';
import { unwatch, watch } from '../controllers/repositories/repository-watch.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { optionalAuthMiddleware } from '../middleware/optional-auth.middleware.js';
import { getRefs } from '../controllers/repositories/repository-content.controller.js';
import {
  createBranch,
  deleteBranch,
  renameBranch,
  getBranch,
  getBranches,
  getBlob,
  getCommit,
  getCommits,
  getContent,
  getRawContent,
  getReadme,
  getCommitDiff,
  compareCommits,
  compareBranches,
} from '../controllers/repositories/repository-git.controller.js';
import { getTree } from '../controllers/repositories/repository-tree.controller.js';
import {
  addCollaborator,
  create,
  getOne,
  listByUsername,
  listCollaborators,
  remove,
  update,
  updateCollaborator,
  removeCollaborator,
} from '../controllers/repositories/repository.controller.js';

import {
  create as createLabel,
  list as listLabels,
  getOne as getLabel,
  update as updateLabel,
  remove as deleteLabel,
} from '../controllers/labels/label.controller.js';
import {
  create as createMilestone,
  list as listMilestones,
  getOne as getMilestone,
  update as updateMilestone,
  remove as deleteMilestone,
} from '../controllers/milestones/milestone.controller.js';
const router = Router();

router.post('/', authMiddleware, create);
router.get('/:username', listByUsername);
router.get('/:username/:name/git/refs', optionalAuthMiddleware, getRefs);
router.post('/:username/:name/git/branches', authMiddleware, createBranch);
router.delete('/:username/:name/git/branches', authMiddleware, deleteBranch);
router.patch('/:username/:name/git/branches', authMiddleware, renameBranch);
router.get('/:username/:name/git/branches', optionalAuthMiddleware, getBranches);
router.get('/:username/:name/git/branches/details', optionalAuthMiddleware, getBranch);
router.get('/:username/:name/git/tree', optionalAuthMiddleware, getTree);
router.get('/:username/:name/git/contents', optionalAuthMiddleware, getContent);
router.get('/:username/:name/git/raw', optionalAuthMiddleware, getRawContent);
router.get('/:username/:name/git/readme', optionalAuthMiddleware, getReadme);
router.get('/:username/:name/git/blobs/:sha', optionalAuthMiddleware, getBlob);
router.get('/:username/:name/git/commits', optionalAuthMiddleware, getCommits);
router.get('/:username/:name/git/compare/commits', optionalAuthMiddleware, compareCommits);
router.get('/:username/:name/git/compare/branches', optionalAuthMiddleware, compareBranches);
router.get('/:username/:name/git/commits/:sha/diff', optionalAuthMiddleware, getCommitDiff);
router.get('/:username/:name/git/commits/:sha', optionalAuthMiddleware, getCommit);
router.post('/:username/:name/milestones', authMiddleware, createMilestone);
router.get('/:username/:name/milestones', optionalAuthMiddleware, listMilestones);
router.get('/:username/:name/milestones/:milestoneId', optionalAuthMiddleware, getMilestone);
router.patch('/:username/:name/milestones/:milestoneId', authMiddleware, updateMilestone);
router.delete('/:username/:name/milestones/:milestoneId', authMiddleware, deleteMilestone);
router.patch('/:username/:name/issues/:number/milestone', authMiddleware, updateIssueMilestone);
router.patch(
  '/:username/:name/pulls/:number/milestone',
  authMiddleware,
  updatePullRequestMilestone,
);
router.post('/:username/:name/labels', authMiddleware, createLabel);
router.get('/:username/:name/labels', optionalAuthMiddleware, listLabels);
router.get('/:username/:name/labels/:labelId', optionalAuthMiddleware, getLabel);
router.patch('/:username/:name/labels/:labelId', authMiddleware, updateLabel);
router.delete('/:username/:name/labels/:labelId', authMiddleware, deleteLabel);
router.post('/:username/:name/issues/:number/assignees', authMiddleware, addIssueAssignee);
router.get('/:username/:name/issues/:number/assignees', optionalAuthMiddleware, listIssueAssignees);
router.delete(
  '/:username/:name/issues/:number/assignees/:assigneeUsername',
  authMiddleware,
  removeIssueAssignee,
);
router.post('/:username/:name/issues/:number/labels', authMiddleware, createIssueLabel);
router.delete('/:username/:name/issues/:number/labels/:labelId', authMiddleware, deleteIssueLabel);
router.post('/:username/:name/issues', authMiddleware, createIssue);
router.get('/:username/:name/issues', optionalAuthMiddleware, listIssues);
router.get('/:username/:name/issues/:number', optionalAuthMiddleware, getIssue);
router.patch('/:username/:name/issues/:number', authMiddleware, updateIssue);

router.post('/:username/:name/issues/:number/comments', authMiddleware, createIssueComment);

router.get('/:username/:name/issues/:number/comments', optionalAuthMiddleware, listIssueComments);

router.patch(
  '/:username/:name/issues/:number/comments/:commentId',
  authMiddleware,
  updateIssueComment,
);

router.delete(
  '/:username/:name/issues/:number/comments/:commentId',
  authMiddleware,
  deleteIssueComment,
);

router.post('/:username/:name/pulls/:number/labels', authMiddleware, createPullRequestLabel);
router.delete(
  '/:username/:name/pulls/:number/labels/:labelId',
  authMiddleware,
  deletePullRequestLabel,
);
router.post('/:username/:name/pulls', authMiddleware, createPullRequest);
router.get('/:username/:name/pulls', optionalAuthMiddleware, listPullRequests);
router.get('/:username/:name/pulls/:number', optionalAuthMiddleware, getPullRequest);
router.patch('/:username/:name/pulls/:number', authMiddleware, updatePullRequest);

router.get('/:username/:name/pulls/:number/commits', optionalAuthMiddleware, getPullRequestCommits);
router.get('/:username/:name/pulls/:number/diff', optionalAuthMiddleware, getPullRequestDiff);
router.get(
  '/:username/:name/pulls/:number/mergeability',
  optionalAuthMiddleware,
  getPullRequestMergeability,
);
router.post('/:username/:name/pulls/:number/merge', authMiddleware, mergePullRequest);

router.post('/:username/:name/pulls/:number/reviews', authMiddleware, submitPullRequestReview);
router.get(
  '/:username/:name/pulls/:number/reviews',
  optionalAuthMiddleware,
  listPullRequestReviews,
);
router.get(
  '/:username/:name/pulls/:number/review-state',
  optionalAuthMiddleware,
  getPullRequestReviewState,
);
router.post(
  '/:username/:name/pulls/:number/comments',
  authMiddleware,
  createPullRequestGeneralComment,
);
router.get(
  '/:username/:name/pulls/:number/conversations',
  optionalAuthMiddleware,
  listPullRequestConversations,
);
router.post('/:username/:name/star', authMiddleware, star);
router.post('/:username/:name/watch', authMiddleware, watch);
router.delete('/:username/:name/watch', authMiddleware, unwatch);
router.delete('/:username/:name/star', authMiddleware, unstar);
router.get('/:username/:name/stars/count', optionalAuthMiddleware, getStarCount);
router.get('/:username/:name', getOne);
router.patch('/:username/:name', authMiddleware, update);
router.delete('/:username/:name', authMiddleware, remove);

router.post('/:username/:name/collaborators', authMiddleware, addCollaborator);
router.get('/:username/:name/collaborators', authMiddleware, listCollaborators);
router.patch(
  '/:username/:name/collaborators/:collaboratorUsername',
  authMiddleware,
  updateCollaborator,
);
router.delete(
  '/:username/:name/collaborators/:collaboratorUsername',
  authMiddleware,
  removeCollaborator,
);

router.post(
  '/:username/:name/pulls/:number/inline-comments',
  authMiddleware,
  createPullRequestInlineComment,
);

router.patch(
  '/:username/:name/pulls/:number/comments/:commentId',
  authMiddleware,
  editPullRequestComment,
);

router.delete(
  '/:username/:name/pulls/:number/comments/:commentId',
  authMiddleware,
  deletePullRequestComment,
);

router.post(
  '/:username/:name/pulls/:number/conversations/:conversationId/comments',
  authMiddleware,
  createPullRequestConversationComment,
);

router.post(
  '/:username/:name/pulls/:number/conversations/:conversationId/resolve',
  authMiddleware,
  resolvePullRequestConversation,
);

router.post(
  '/:username/:name/pulls/:number/conversations/:conversationId/reopen',
  authMiddleware,
  reopenPullRequestConversation,
);

export default router;
