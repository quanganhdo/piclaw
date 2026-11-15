# Native branch routing identity

`app.application-conversations` owns branch→native-conversation/session bindings. Each binding fixes the application domain, chat JID, stable host branch ID, SDK conversation ID and host session ID. Per-conversation `app.application-identity` is a creation-time integrity anchor. Host SQL owns friendly handles, display names, ownership and archive policy; SDK documents/tasks own execution state.

## Immutable identities and mutable metadata

| Surface | Owner and mutation |
|---|---|
| Application binding | Default native factory, through one public SDK binding publisher. Initial creation and lazy root creation use the same publisher. |
| Creation anchor | One exact version 1 base record. Startup verifies the original bytes against the binding and rejects missing, conflicting or additional revisions. |
| Host branch | `branch_id` and native chat JID remain stable. `agent_name` is a friendly handle; `chats.name` is display metadata. Neither selects a native conversation. |
| Archive policy | Host SQL. A retained binding may be archived; current admission and session/control lookup require the exact active SQL branch. |
| Runtime routes | Derived from the canonical manifest. There is one publication point after a successful commit, with current SQL policy rechecked. |
| Accepted sources and imports | Immutable host binding hashes, source identities, imported bytes and entry mappings remain provenance. They are never renamed into current metadata. |

The Core policy fence recognises a native host store without importing a private SDK delta engine. It never resolves a conversation or reconstructs a missing manifest. The private runtime still performs complete manifest, creation-anchor and accepted-source validation.

Friendly handle rename changes host metadata without writing a legacy SDK session name. Native addresses cannot use legacy JID rename, reparent, merge, destructive purge or deferred UI-child-fork paths. Those operations fail before SQL, pool eviction or file changes. Legacy owned-fork publication is fenced after its normal owner validation as well. The existing friendly-rename interaction remains available. Supported scheduled/side-prompt SDK forks and copied-history imports retain their own exact provenance and APIs; a legacy child is never treated as its parent or as an empty native root.

Metadata registration cannot silently unarchive, reparent or rename a native branch. Explicit default-native restore updates SQL policy and verifies the exact existing live route in the same synchronous frame. An unavailable route rolls back the policy change. Restore allocates no SDK identity and starts no legacy session or provider request.

## Publication and interruption

Fresh default creation uses the public SDK `root({ init })` commit for root configuration, every initial host conversation, every creation anchor and the populated application manifest. Failure inside that transaction leaves none of those records. A lost acknowledgement after commit is reconciled by reopening the committed manifest; no second allocation is attempted.

The SDK schema prefix may survive an interrupted first startup before any application domain is published. That incomplete prefix remains fail-closed and requires an explicit validated matching checkpoint. Startup never guesses, resets or adopts it.

Later root creation retains its existing public SDK transaction and post-commit route publication. Current branch identity/archive policy is checked again under the candidate writer lock and before publication. If policy changes while creation is preparing, no route is published. A failure after the commit-attempt boundary stays uncertain until reopen, including when an isolated test can prove that its injected refusal happened before the write.

## Archive and restore

Archive is a synchronous host owner transaction. It refuses accepted operations, unconsumed/queued sources, uncertain request holds and live SDK maintenance in the branch scope. Scope includes recorded operation forks and SDK parent/ownership ancestry. Unrelated live work does not block the branch. An incomplete authority schema fails closed.

The guard walks live-task ancestors by conversation primary key and reads retained binding references; it does not traverse all retained historical forks. These checks run while holding the host writer lock. They perform no provider I/O or task cancellation.

Archive also asks the live runtime owner for branch-scoped command, maintenance and credential-control activity. The owner exposes its existing control state through a synchronous fence. Without that owner, archive fails closed; uncertain cleanup retains the fence until confirmed close. Native commands revalidate their active binding after preparation and before spawning a shell. An active command keeps its route and abort control available.

Cached queue admission callbacks recheck their exact active binding inside the committing SQL frame. Side-prompt admission rechecks after asynchronous history/payload work and inside its source/operation transaction. An archive that wins either race leaves no new source, operation, budget work, queue row or SDK fork. An immutable payload file may remain without granting authority.

Archive changes ordinary and side-prompt ingress policy. Explicit scheduling definitions, occurrence leases and their settlement remain with the scheduling owner; no scheduling state is retired or rewritten here.

Archived default-native bindings stay in the manifest so history and accepted-source integrity remain verifiable on reopen. They disappear from active route/session targets and cannot accept inputs or controls. Metadata registration keeps them archived. Legacy Dream reapers and orphan-session cleanup retain native/imported identity metadata and accepted history; they do not treat a missing legacy session directory as proof of disposability. Explicit bound restore reuses the same branch, conversation and session IDs.

Copied/imported bundles retain their existing strict publication contract. A store without the default application manifest does not acquire default-native archive policy from a marker alone. Owner-local handle namespaces, home protections and household policy remain separate host controls.

## Existing data and recovery

This change adds no table, column, index, migration receipt, SDK document field or sidecar. Valid existing manifests keep their native IDs, session IDs, source hashes and imported history. Conflicting/missing mappings and previously broken address moves still fail; startup does not repair them from SQL metadata. The read-only ownership inventory records the same physical fingerprints.

Task moves still author definition revisions under #1694. Usage reports retain the explicit moved-chat projection exception from #1695; billing events are not rewritten. Native legacy-address mutation is refused before either history path can be altered. Retiring bound native identities requires a separate coordinated owner protocol (#1691/#1702).

Backups must include the main SQLite database, SDK records and host metadata together. Executable-only downgrade after archiving a native binding may fail under older active-only validation; use a validated matching runtime/database checkpoint. Source delivery does not authorise deployment, live schema changes, restore, pruning or replay.
