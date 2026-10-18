# Phase 10 - Labels and Milestones

## Overview

Phase 10 adds repository-scoped labels and milestones for GitZone issues and pull requests.

Technology stack: Node.js, Express, TypeScript, Prisma, PostgreSQL, Zod, and Vitest.

## Implemented Features

### Labels

- Label CRUD operations.
- Issue and pull request label assignments.
- Repository-scoped unique label names.
- Duplicate assignment prevention.
- Strict request validation.

### Milestones

- Milestone CRUD operations.
- OPEN and CLOSED milestone states.
- Optional due dates and descriptions.
- Issue and pull request milestone assignments.
- Milestone progress statistics.
- Pagination and state filtering.
- Transactional milestone deletion.

## Authentication and Authorization

| Operation                            | Required permission |
| ------------------------------------ | ------------------- |
| List or view labels                  | Repository READ     |
| Create, update, or delete labels     | Repository WRITE    |
| Assign or remove issue/PR labels     | Repository WRITE    |
| List or view milestones              | Repository READ     |
| Create, update, or delete milestones | Repository WRITE    |
| Assign or remove issue/PR milestones | Repository WRITE    |

Public repository reads support optional authentication.
Private repository reads require appropriate authorization.
Mutations require authentication and repository WRITE permission.

Repository owners have full access. READ collaborators cannot mutate labels or milestones.

## Labels API

Base path: `/api/repositories/:username/:name/labels`

| Method | Endpoint    | Description    | Success |
| ------ | ----------- | -------------- | ------- |
| POST   | `/`         | Create label   | 201     |
| GET    | `/`         | List labels    | 200     |
| GET    | `/:labelId` | Retrieve label | 200     |
| PATCH  | `/:labelId` | Update label   | 200     |
| DELETE | `/:labelId` | Delete label   | 204     |

### Create Label

Request example:

```json
{
  "name": "bug",
  "color": "#FF0000",
  "description": "Something is not working"
}
```

Validation rules:

- `name`: required, trimmed, 1-50 characters.
- `color`: required, six-digit HEX value, normalized to uppercase.
- `description`: optional, nullable, trimmed, maximum 255 characters.
- Unknown fields are rejected.

Successful creation returns HTTP 201 with the created label in `data.label`.

### List and Retrieve Labels

- GET `/labels` returns labels in `data.labels`.
- Labels are sorted by name ascending, then ID ascending.
- GET `/labels/:labelId` returns the label in `data.label`.

### Update Label

PATCH accepts `name`, `color`, and `description`.
At least one field is required.
A successful update returns HTTP 200 with `data.label`.

### Delete Label

DELETE returns HTTP 204 without a response body.

## Issue and Pull Request Label Assignments

All paths below are relative to `/api/repositories/:username/:name`.

| Method | Endpoint                          | Success |
| ------ | --------------------------------- | ------- |
| POST   | `/issues/:number/labels`          | 201     |
| DELETE | `/issues/:number/labels/:labelId` | 204     |
| POST   | `/pulls/:number/labels`           | 201     |
| DELETE | `/pulls/:number/labels/:labelId`  | 204     |

Assignment request:

```json
{
  "labelId": "existing-label-cuid"
}
```

POST responses return the assigned label in `data.label`.
Duplicate assignments return HTTP 409 with `LABEL_ALREADY_ASSIGNED`.
Removing an assignment that does not exist returns HTTP 404.

## Milestones API

Base path: `/api/repositories/:username/:name/milestones`

| Method | Endpoint        | Description        | Success |
| ------ | --------------- | ------------------ | ------- |
| POST   | `/`             | Create milestone   | 201     |
| GET    | `/`             | List milestones    | 200     |
| GET    | `/:milestoneId` | Retrieve milestone | 200     |
| PATCH  | `/:milestoneId` | Update milestone   | 200     |
| DELETE | `/:milestoneId` | Delete milestone   | 204     |

### Create Milestone

Example request:

```json
{
  "title": "Version 1.0",
  "description": "First stable release",
  "dueDate": "2026-12-31T18:00:00+05:00"
}
```

Validation:

- `title`: required, trimmed, 1-256 characters.
- `description`: optional, nullable, trimmed, maximum 10000 characters.
- `dueDate`: optional, nullable, timezone-aware ISO datetime.
- Unknown fields are rejected.
- New milestones default to OPEN.

Successful creation returns HTTP 201 with `data.milestone`.

### List Milestones

Supported query parameters:

| Parameter | Allowed values   | Default   |
| --------- | ---------------- | --------- |
| `state`   | OPEN or CLOSED   | No filter |
| `page`    | Integer 1-100000 | 1         |
| `limit`   | Integer 1-100    | 20        |

Example:

`GET /api/repositories/asil/demo/milestones?state=OPEN&page=1&limit=20`

The response contains `data.milestones` and `data.pagination`.

Pagination contains:

- `page`
- `limit`
- `total`
- `totalPages`

Milestones are ordered by creation date descending, then ID ascending.
Each listed milestone includes progress statistics.

### Retrieve Milestone

GET `/:milestoneId` returns HTTP 200 with `data.milestone`.
The milestone includes progress statistics.

### Update Milestone

PATCH accepts one or more of:

- `title`
- `description`
- `dueDate`
- `state`

State must be OPEN or CLOSED.
An empty update object is rejected.

Changing state from OPEN to CLOSED sets `closedAt`.
Changing state from CLOSED to OPEN clears `closedAt`.

A successful update returns HTTP 200 with `data.milestone`.

### Delete Milestone

Milestone deletion uses a database transaction:

1. Detach matching repository issues.
2. Detach matching repository pull requests.
3. Delete the milestone.

The endpoint returns HTTP 204 without a response body.

## Issue and Pull Request Milestone Assignments

All paths below are relative to `/api/repositories/:username/:name`.

| Method | Endpoint                    | Success |
| ------ | --------------------------- | ------- |
| PATCH  | `/issues/:number/milestone` | 200     |
| PATCH  | `/pulls/:number/milestone`  | 200     |

Assignment request:

```json
{
  "milestoneId": "existing-milestone-cuid"
}
```

To remove an assignment:

```json
{
  "milestoneId": null
}
```

The issue endpoint returns `data.issue`.
The pull request endpoint returns `data.pullRequest`.
Both responses include the milestone relation.

## Milestone Progress

Progress fields:

- `totalIssues`
- `closedIssues`
- `totalPullRequests`
- `completedPullRequests`
- `totalItems`
- `completedItems`
- `openItems`
- `percentage`

A CLOSED issue counts as completed.
A CLOSED or MERGED pull request counts as completed.

Calculation:

`percentage = completedItems / totalItems * 100`

The result is rounded to two decimal places.
When totalItems is zero, percentage is zero.

The milestone list service uses grouped database queries
to calculate progress for multiple milestones efficiently.

## Database Architecture

### Label Model

- Labels belong to repositories.
- Each label has an ID, name, color, optional description, and timestamps.
- Unique constraint: `(repositoryId, name)`.
- Repository deletion cascades to its labels.

### Label Assignment Models

`IssueLabel` uses composite primary key `(issueId, labelId)`.
`PullRequestLabel` uses composite primary key `(pullRequestId, labelId)`.

These constraints prevent duplicate assignments.
Assignment records cascade on deletion of their related entities.

### Milestone Model

- Each milestone belongs to a repository.
- Fields include title, description, state, dueDate, and closedAt.
- State defaults to OPEN.
- Unique constraint: `(repositoryId, title)`.
- Additional unique constraint: `(repositoryId, id)`.
- Repository deletion cascades to milestones.

### Repository-Scoped Foreign Keys

Issue and pull request milestone relations use:

`(repositoryId, milestoneId) -> Milestone(repositoryId, id)`

These composite foreign keys prevent referencing milestones
that belong to a different repository.

Both foreign keys use NO ACTION for DELETE and UPDATE.

### Transactional Milestone Deletion

Milestone deletion runs inside a Prisma database transaction:

1. Set matching issue milestoneId values to null.
2. Set matching pull request milestoneId values to null.
3. Delete the milestone.

All operations are scoped to the requested repository.
A failed transaction rolls back its database changes.

## Database Migrations

Phase 10 includes two migrations:

1. `20261008144540_add_labels_and_milestones`
2. `20261008160938_scope_milestone_foreign_keys`

The first migration creates labels, milestones, assignment tables,
indexes, and initial milestone foreign keys.

The second migration replaces single-column milestone foreign keys
with repository-scoped composite foreign keys.

The primary PostgreSQL database was verified with 17 applied migrations.

An isolated PostgreSQL test verified the composite foreign keys
and rejected cross-repository milestone assignments.

## Security

- Service-layer repository authorization is required.
- Public repository reads may use optional authentication.
- Private repository reads require authorized access.
- Mutations require authentication and WRITE permission.
- Labels and milestones are resolved within their repository.
- Issue and pull request numbers are repository-scoped.
- Strict Zod validation rejects unknown request fields.
- Database constraints prevent duplicate label assignments.
- Composite milestone foreign keys enforce repository isolation.
- Milestone deletion uses a database transaction.

## Testing and Verification

### Automated Quality Gate

Latest recorded full backend verification:

- 83 test files passed.
- 961 automated tests passed.
- Source TypeScript type checking passed.
- Test TypeScript type checking passed.
- ESLint passed.
- Production build passed.
- Prisma migration status passed.

### Database Verification

- Primary PostgreSQL migrations were applied.
- Isolated PostgreSQL migration verification passed.
- Composite foreign key constraints were validated.
- Cross-repository milestone assignment was rejected.

### Verification Limitations

The HTTP integration tests use mocked dependencies.
They are not equivalent to a complete real PostgreSQL-backed HTTP E2E suite.

The transactional milestone deletion logic has automated unit tests,
but a real PostgreSQL rollback E2E test has not been established.

## Scope and Status

Phase 10 covers backend labels, milestones, assignments,
validation, authorization, migrations, and automated tests.

Frontend label and milestone management interfaces are out of scope.

Implementation commit: `db25989`.

Documentation and architecture updates have been prepared.

The 16 Phase 10 API routes were checked against this document.

Final documentation audit, commit, and push are pending.
