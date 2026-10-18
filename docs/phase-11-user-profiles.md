# GitZone - Phase 11: User Profiles

## Overview

Phase 11 provides public profiles, authenticated profile updates, avatars,
public repositories, activity, and contributions.

## API Endpoints

| Method | Endpoint                           | Access |
| ------ | ---------------------------------- | ------ |
| GET    | /api/users/:username               | Public |
| PATCH  | /api/users/me                      | JWT    |
| PATCH  | /api/users/me/avatar               | JWT    |
| GET    | /api/users/avatars/:filename       | Public |
| GET    | /api/users/:username/repositories  | Public |
| GET    | /api/users/:username/activity      | Public |
| GET    | /api/users/:username/contributions | Public |

## Profile Updates

PATCH /api/users/me accepts JSON containing at least one field.
Allowed fields: username, name, bio, location, website.
Username: 3-30 characters, letters, digits, underscore, hyphen.
Name: 1-100 trimmed characters or null.
Bio: maximum 500 characters or null.
Location: maximum 100 characters or null.
Website: HTTPS URL without credentials, maximum 2048 characters, or null.
Unknown properties are rejected.

## Avatar Upload

PATCH /api/users/me/avatar requires Bearer JWT.
Use multipart/form-data with the field named avatar.
Accepted input formats: JPEG, PNG, WebP.
Maximum upload size: 5 MiB.
Images are validated and re-encoded as WebP.
Output dimensions fit within 512 x 512 pixels.
Animated images and unsafe image metadata are rejected.

## Avatar Retrieval

GET /api/users/avatars/:filename returns image/webp.
Filenames are UUID-based and end in .webp.
Filesystem checks reject unsafe paths and symbolic links.
Avatar storage is isolated from Git repository storage.

## Privacy

Public profile responses explicitly select permitted fields.
Private repositories are excluded from public repository listings.
Activity and contribution calculations exclude private repositories.

## Security

Profile mutations require authentication.
Profile JSON uses strict Zod validation.
Avatar uploads enforce MIME, size, and decoded-image validation.
Avatar replacement uses optimistic concurrency protection.
Old unreferenced local avatars are cleaned up after replacement.

## Verification

Windows: TypeScript typecheck PASS.
Windows: test typecheck PASS.
Windows: ESLint PASS.
Windows: production build PASS.
Windows: 104 Vitest files and 1152 tests PASS.
Windows: npm audit reports zero vulnerabilities.
Windows: avatar upload, read, replace and rejection E2E PASS.
Temporary E2E user and test avatar were removed.

## Cross-platform Status

Implementation targets Windows, Linux, and macOS.
Native Linux and macOS verification remains outstanding.

## Remaining Release Tasks

- Phase 11 Postman collection
- Final code review
- Commit and push
