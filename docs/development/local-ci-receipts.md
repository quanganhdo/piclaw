# Local CI receipts

`make pre-push-ci` records private local evidence for the exact commit tested in a detached temporary worktree. The pre-push hook uses the same launcher for commits pushed to main. Hosted checks continue to run unchanged.

The launcher installs the frozen lockfile before running the gate. Each run creates a UUID-named JSON receipt and a separate raw log under the common Git directory's `local-ci-receipts/`. Set `PICLAW_PRE_PUSH_RECEIPT_DIR` to use another directory outside the tested worktree. The directory is mode 0700; receipt and log files are mode 0600.

## Recorded fields

Schema version 1 records:

- a hash of the repository origin (the URL itself may contain credentials and is excluded);
- tested commit and tree, clean state before and after execution;
- dependency lock hash, pinned and actual Bun versions;
- command hash and a hash of tracked gate scripts, workflow/config files and their content hashes;
- start/end timestamps, exit code and run status;
- separate `ci-fast`, `browser`, `install-smoke`, `integration` and `e2e` capability entries;
- parsed test-summary counts, log SHA256 and byte length.

Only the exact `make ci-fast` command can record the `ci-fast` capability. Command overrides record their command hash but leave every capability `not-run`. This launcher does not execute or qualify browser acceptance, global-install smoke, integration or E2E. Missing test summaries produce null counts, never invented zeros. Counts combine the summaries printed by the gate's test subprocesses.

A non-zero child exit records failure. SIGINT/SIGTERM records interruption; an uncatchable termination leaves the initial `running` receipt, which cannot qualify. Dirty or changed source and a pinned/actual Bun mismatch cannot pass. Installation failure stops before gate execution and creates no passing receipt.

## Privacy and trust

JSON receipts exclude raw commands, logs, environment variables, credentials and prompts. Raw gate output can contain private data: retain it only in the private local log directory. Do not attach or upload raw logs without review. Nothing in this change uploads evidence, grants a trusted GitHub check or skips hosted work. Receipts are unsigned local records; the publisher/trust boundary belongs to separate work.

## Checks

```sh
bun run test:local -- bun test ./runtime/test/scripts/local-ci-receipt.test.ts
make pre-push-ci
```

The first command tests identity changes, failed/dirty runs, counts, permissions and interruption using disposable repositories. The second runs the canonical gate at committed HEAD. Uncommitted changes in the caller are excluded because the launcher tests a detached commit.
