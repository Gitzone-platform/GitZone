# Phase 12 - Repository Social Features and Forks

## Status

Implemented and verified on Windows.

## Features

- Repository star, unstar, star count, and user starred repositories.
- Repository watch, unwatch, preferences, and watcher count.
- Watch preferences: ALL, PARTICIPATING, IGNORE.
- Repository fork creation and parent relationship.
- Fork network metadata with private repository access filtering.
- Bare Git repository cloning and failure rollback.

## API Endpoints

Base URL: /api

| Method | Endpoint                                        | Authentication |
| ------ | ----------------------------------------------- | -------------- |
| POST   | /repositories/:username/:name/star              | Required       |
| DELETE | /repositories/:username/:name/star              | Required       |
| GET    | /repositories/:username/:name/stars/count       | Optional       |
| GET    | /users/:username/starred                        | Optional       |
| POST   | /repositories/:username/:name/watch             | Required       |
| DELETE | /repositories/:username/:name/watch             | Required       |
| PATCH  | /repositories/:username/:name/watch/preferences | Required       |
| GET    | /repositories/:username/:name/watchers/count    | Optional       |
| POST   | /repositories/:username/:name/fork              | Required       |
| GET    | /repositories/:username/:name/forks/network     | Optional       |

## Security

- Private repositories require appropriate read authorization.
- Private source repositories cannot be forked as public.
- Repository name collisions are rejected.
- Existing Git destinations are not overwritten.
- Fork network results filter inaccessible private repositories.

## Git Fork and Rollback

Forks use git clone --bare --no-hardlinks.
The database records the parent using forkedFromId.
Failed Git creation triggers database rollback.
An occupied Git destination is preserved.

## Verification

- 128 test files passed.
- 1340 tests passed; 49 skipped.
- 5 isolated real PostgreSQL and Git fork tests passed.
- Source and test typechecks passed.
- ESLint and production build passed.
- HTTP health, missing repository, invalid token, and unknown route checks passed.

## Limitations

- Verification performed on Windows.
- Linux and macOS not verified.
- Notification delivery not implemented.
- Complete authenticated Postman E2E coverage not established.
- Passing tests do not guarantee production readiness.
