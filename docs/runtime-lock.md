# Runtime lock recovery

## Existing runtime locks

Every enabled runtime-lock acquirer, including ordinary startup and offline maintenance, refuses any existing `runtime.lock` path. Empty, malformed and apparently dead-PID records remain unchanged. Automatic stale-lock recovery is intentionally disabled: exclusive file creation publishes the path before the JSON record, so an empty path may belong to a process still acquiring ownership.

After SIGKILL, a crash or failed lock publication, startup and maintenance may require manual cleanup:

1. Confirm the host, workspace, configured store and service manager. Stop every runtime and maintenance process for that workspace and prevent automatic restart.
2. Verify that no owner or other writer remains. PID, command text or lock age alone cannot authorise removal. If ownership is uncertain, leave the lock untouched.
3. Remove only that store's `runtime.lock` manually while all writers remain stopped. Never remove the database, WAL/SHM files or authentication state to clear a lock error. Never replace or remove a lock while an owner may be running.
4. Retry the intended command. Restore service management only after a separately authorised normal startup.

Normal exact-owner release removes its own unchanged lock. The lock directory must be trusted; release cannot atomically compare an inode and unlink it through Node's filesystem API. This fail-closed policy can prevent unattended restart after a crash. Disabling locking is not a recovery procedure; maintenance always requires the lock and strict ownership rejects disabled locking.
