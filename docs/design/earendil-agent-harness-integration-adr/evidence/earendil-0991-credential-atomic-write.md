# Atomic credential-file replacement (#1458)

Piclaw stages complete credential JSON in a private same-directory file, syncs it and replaces `auth.json` by rename under the existing file lock. Owned process-loss fixtures leave complete old or new JSON at the tested checkpoints. This is local POSIX process-crash evidence, not power-loss or general filesystem durability certification.

## Write and commit boundary

The app-owned writer creates a unique `wx` staging file with mode 0600, writes and syncs it, closes it, renames it over the target and syncs the parent directory on POSIX. Windows uses the same replacement path without directory sync; it has no platform-specific receipt in this slice.

Pre-rename failures preserve the old file and clean staging where possible. Descriptor cleanup and staging cleanup run outside `finally` control flow, preserving commit state and using generic diagnostics. If cleanup itself fails, the error reports that failure without raw paths or credential-bearing exception text.

Rename is the credential commit point. A later directory-sync failure produces a typed app-owned commit error; the store records it in `drainErrors()` and emits metadata-only warning, while returning the new authoritative credential. It does not report a failed mutation that could cause a caller to restore an already superseded token. Power-loss persistence after an unsuccessful directory sync is unknown.

The store refuses symlink, hardlinked and non-regular targets. On POSIX, it verifies the directly supplied credential directory/file ownership, uses no-follow descriptor opens for validation/read, and enforces 0700/0600. This assumes an app-owned parent directory without attacks by the owning UID; ancestor-directory substitution and arbitrary hostile shared roots are not certified. Initial creation uses `wx`, so two initializers cannot overwrite each other's file.

## Fault and process-loss fixtures

The optional app-owned file-I/O seam injects failures at staging open, partial write, file sync, close before/after close, rename, directory sync and cleanup. Tests check original/new file bytes, private permissions, descriptor cleanup and generic error output. A store-level directory-sync failure test verifies committed state, cross-instance reads and redacted warning records.

Owned child fixtures block during partial staging, after file sync before rename, and immediately after rename. The parent asserts the child was alive, kills only that child, checks SIGKILL and reads complete old/new JSON. Pre-rename deaths leave a private staging file; after rename there is none. These are helper checkpoints using the same production I/O path, not random mid-instruction crash fuzzing or filesystem power-loss tests.

Staging files left by an abrupt process death are not read as credentials and are not deleted automatically. They may contain synthetic/real private credential bytes and need a separately reviewed retention/cleanup policy. No bulk cleanup or historical-secret deletion occurs here.

## Validation

The failure/store/owned-crash set passed 30 tests and 166 assertions. The post-cross-process-merge writer/store/public-runtime lifecycle and cross-process set passed 40 tests and 219 assertions, including the real stale-lock recovery case. Strict fixture typechecks, all five standard typechecks, scoped lint and diff checks passed. Reviews corrected cleanup, descriptor and directly supplied path safety; final scoped review found no blocker for the private POSIX parent scope.

The first focused run hit the existing concurrent-mutation five-second test budget; an unchanged rerun passed 22 tests and 115 assertions. No timeout was raised. At merged cross-process baseline `e7539b67a5c501c5e875ff42fe568e5ca2d2b186`, `make ci-fast` passed 5,969 runtime tests, eight skips and no failures, 25 feature tests and nine web checks. Seven skips are existing and one is the earlier opt-in stale-lock fixture, separately executed in the 40-test set. Pack hygiene passed 24,742 files; final five typechecks and diff checks passed with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without shared-cache permission changes.

## Remaining qualification

Atomic replacement does not certify every filesystem, Windows behavior, parent-ancestor attack, power failure or stale staging-file retention. Legacy configuration keys/backups, all provider/device/CLI/UI paths, Delegate children and approved live accounts remain open. No live credential, account, inference, deployment or restart was used.
