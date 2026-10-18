# Phase 13.17 — Repository Transfer Recovery

## Transfer invariants

- Transfer moves logical repository ownership from a user to an organization.
- The source Git directory is preserved during and after transfer.
- The destination Git directory must never overwrite an existing path.
- PostgreSQL namespace write locks protect the transfer operation.
- In-process namespace write locks provide additional coordination.
- A durable repository transfer journal records progress.
- Unfinished transfers block Git HTTP write operations.
- Repository ownership switches only after destination integrity verification.

## Transfer journal states

- `PENDING`: journal created.
- `MOVING`: filesystem transfer in progress or interrupted.
- `MOVED`: destination verified; ownership switch pending.
- `COMPLETED`: database ownership switch completed.
- `FAILED`: reserved failure state; not an authorization to delete data.

## Interrupted publication

Publication is not atomic.

A failure can leave:

- The original source repository intact.
- A partially populated destination directory.
- A staging directory containing remaining entries.
- A journal in an unfinished state.

Never assume that a destination or staging directory can be safely deleted.

## Recovery policy

Recovery inspection is read-only.

It may inspect:

- Source directory state.
- Staging directory state.
- Destination directory state.
- Transfer ownership markers.
- Journal status.

Automatic rollback and automatic resume are disabled.

An operator must investigate any incomplete or inconsistent transfer before
performing filesystem or database changes.

## Completed transfers and source retention

After a completed transfer, the original personal Git directory remains on disk.

The old personal Git HTTP repository path is no longer resolved through the
transferred repository's database ownership.

The retained source directory can prevent creation of another personal
repository with the same name.

This is an intentional data-preservation tradeoff, not automatic cleanup.

## Manual cleanup restrictions

Before considering any manual cleanup:

1. Confirm the journal is `COMPLETED`.
2. Confirm database ownership points to the expected organization.
3. Confirm destination Git repository integrity.
4. Confirm repository references and required objects are available.
5. Confirm the source and destination paths refer to the expected repositories.
6. Take a verified backup and follow an approved operational procedure.

Do not delete source, staging, or destination directories solely because
a transfer API request failed or returned a timeout.

Do not treat a filesystem ownership marker alone as sufficient proof
that cleanup is safe.

## Known limitations

- Publication is non-atomic.
- Recovery requires operator intervention.
- Source Git directories remain after successful transfers.
- A failed transfer may leave an unfinished journal and block writes.
- Database-backed transfer recovery has not been validated by the skipped
  optional database integration tests.
