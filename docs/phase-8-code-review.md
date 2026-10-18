# Phase 8 - Code Review

## Overview

Phase 8 introduces Git-backed pull request reviews, general and inline comments, review decisions, and conversation management.

## Implemented Features

- Pull request reviews: COMMENTED, APPROVED, CHANGES_REQUESTED.
- General pull request comments.
- Inline comments anchored to actual Git diff lines.
- Reply to review conversations.
- Edit and delete own comments.
- Resolve and reopen conversations.
- Detect outdated inline comments after source branch updates.
- Invalidate stale approvals when the source commit changes.
- Calculate the current review state using the latest actionable review per reviewer.
- Enforce repository permissions and author/reviewer restrictions.

## Authentication and Authorization

- API endpoints use authenticated access.
- Repository READ access permits commenting.
- Repository WRITE access is required for actionable reviews and conversation resolution.
- Pull request authors cannot approve their own pull requests or request changes on them.
- Only a comment author can edit or delete that comment.

## Review API

Base path: `/api/repositories/:username/:name/pulls/:number`

| Method | Endpoint                                  | Description                     |
| ------ | ----------------------------------------- | ------------------------------- |
| POST   | `/reviews`                                | Submit a review                 |
| GET    | `/reviews`                                | List reviews                    |
| GET    | `/review-state`                           | Calculate current review state  |
| POST   | `/comments`                               | Create a general comment        |
| GET    | `/conversations`                          | List conversations and comments |
| POST   | `/inline-comments`                        | Comment on a changed diff line  |
| PATCH  | `/comments/:commentId`                    | Edit own comment                |
| DELETE | `/comments/:commentId`                    | Delete own comment              |
| POST   | `/conversations/:conversationId/comments` | Reply to a conversation         |
| POST   | `/conversations/:conversationId/resolve`  | Resolve a conversation          |
| POST   | `/conversations/:conversationId/reopen`   | Reopen a conversation           |

## Example Requests

Submit an approval:

```json
{
  "state": "APPROVED",
  "body": "Looks good."
}
```

Request changes:

```json
{
  "state": "CHANGES_REQUESTED",
  "body": "Please add tests."
}
```

Create an inline comment:

```json
{
  "body": "Please validate this input.",
  "path": "hello.ts",
  "line": 6,
  "side": "RIGHT"
}
```

## Review State

- REVIEW_REQUIRED: No current actionable approval or changes request.
- APPROVED: Current actionable review approves the pull request.
- CHANGES_REQUESTED: Current actionable review requests changes.
- Review decisions tied to previous source commits do not count toward the current review state.

## Database

Prisma models:

- PullRequestReview
- PullRequestConversation
- PullRequestReviewComment

Migration: `20261007175002_add_code_review`.

## Verification

- Unit tests: passed.
- Integration tests: passed.
- Real HTTP E2E: passed against a repository populated through Git Smart HTTP.
- Verified inline comments, replies, editing, deletion, resolution and reopening.
- Verified outdated comments and stale approval invalidation after a real Git push.
- Verified CHANGES_REQUESTED, self-approval rejection (403), and subsequent approval.
- Full quality gate: 67 test files and 738 tests passed.
- TypeScript, test TypeScript, ESLint, build and Prisma validation passed.
- PostgreSQL migration status: 14 migrations, schema up to date.

## Scope

Phase 8 implements backend code review functionality. Frontend review interfaces are outside this phase.
