# SQLite write admission

`admitSqliteWrite` retries writer-lock acquisition before the transaction callback starts. Once entered, the callback runs at most once for that admission, including its before/after authorization checks. A BUSY/LOCKED error from authorization, the operation or commit is terminal and propagates unchanged when rollback and cleanup succeed. Rollback/cleanup failures retain their existing error behaviour.

The helper preserves Bun's IMMEDIATE transaction/savepoint wrapper. It sets `busy_timeout=0` for each acquisition attempt, restores the prior value before yielding or returning, and retains the existing bounded backoff, abort listener cleanup, deadline and captured-binding checks. Before touching the handle on a new attempt it checks cancellation and the current database binding. Authorization and cancellation are checked again inside the owned transaction, before and after mutation.

Callbacks and rollback hooks must be synchronous. Admission callbacks contain SQL and synchronous authority checks; keep model, network, tool execution and publication outside the transaction. `afterRollback` also runs after failed acquisition, so a hook must tolerate no callback mutation. It restores only the caller-owned memory explicitly covered by that hook. SQLite rollback cannot undo arbitrary external effects or memory changes.

## Audited consumers

| Consumer | Callback and rollback contract |
|---|---|
| Budget request reservation | Captured request/evidence and database/path/file identity; synchronous reservation SQL in a nested savepoint. Failure leaves no new hold or decision. |
| Budget dispatch | Synchronous transition of the original reservation with inner authority/signal checks; no provider send. Failure preserves its prior hold. |
| Incoming web message | Message, spill media, links, full-text index, metadata and source acceptance share the owned transaction. Publication starts after commit. A callback failure returns to the caller without replaying its generated message identity. |
| Deferred follow-up admission | Persisted queue/source acceptance share the transaction. Its rollback hook restores the in-memory negative-row allocator, including terminal callback failure, while preserving queued siblings. |

The message store's busy-during-admission routing hook can use the queue allocator inside its transaction. Its existing failure path may leave a gap in the in-memory negative-row seed; it has no queue-seed rollback hook. This change supplies no universal memory-rewind guarantee. SQL/source changes roll back and the callback is not replayed. Negative projection row IDs remain separate from immutable source UUIDs.

The private-engine `BunSqliteDatabase` adapter retains its separate asynchronous transaction queue and acquisition-only retry loop. Its callback error also remains terminal. [Root/SDK/scheduler connection roles and checkpoint coordination](sqlite-connection-roles.md) define their explicit PRAGMAs and lifecycle; acquisition-only admission does not change those ownership boundaries.

## Verification and compatibility

Focused regressions cover external writer acquisition, callback/auth/commit BUSY, nested savepoint rollback, abort/deadline/binding changes, concurrent read-modify-write, source/wake rollback, postcommit acknowledgement, reservation holds and queue-seed restoration. Guarded and unguarded SDK tests retain the same callback-once contract and verify later transactions remain usable.

A synthetic BUSY probe demonstrated that the previous host helper could replay a callback. No production double-effect incident was established. Callback-raised contention now returns an error; callers must reconcile their own request/intent before initiating any new admission. Successful commits and postcommit publication failures retain their existing acknowledgements.

There is no schema migration, new configuration, dependency change, production database operation, installation, restart or historical-data cleanup.
