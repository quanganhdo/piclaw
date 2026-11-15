# Database bootstrap snapshot

Database startup receives one resolved path snapshot. It no longer mixes frozen `STORE_DIR` with live raw overrides for memory mode and cache identity. An open target cannot silently switch to another file or mode.

## Lifetimes and precedence

Original implementation: `36610b74f1b5e3244325130270b290ab4eb437a8`. Final integration base: `c637741fba10cb92f3d38d01b8be6d18f1c6ed43`; the intervening log-control retirement is separate credit.

- `WORKSPACE_DIR`, `STORE_DIR`, `DATA_DIR`, initial JSON and related module bootstrap constants retain their existing snapshot lifetimes. They are not globally replaced with getters.
- `getRuntimeConfigPaths` and path getters resolve candidate values at call time. They do not authorise moving a bound resource or migrating a workspace.
- `initializeRuntimeEnvironment` passes an explicit candidate snapshot to `initDatabase`. Direct callers/tests keep the no-argument form, which captures the same resolver once. A supplied `Readonly<RuntimeConfigPaths>` controls path, mode and identity even if the environment changes afterward.
- Deliberately reloadable domain readers keep their existing policies; for example, `getWebContentConfig` calls the ordinary-domain reader at use time. Frozen `getWebServerConfig`/`getWebRuntimeConfig` remain frozen/sealed. This change does not make every setting live.

The existing resolver preserves CLI workspace precedence over directory overrides. New `databasePath` is either the resolved store's `messages.db` or `:memory:`. Memory selection retains the existing exact `PICLAW_DB_IN_MEMORY=1`/`true` values and trimmed raw store sentinel `:memory:`; the explicit sentinel also retains its existing database-mode effect with a CLI workspace. Filesystem `storeDir` semantics remain unchanged.

## Bound identity

File targets use the actual absolute database path as cache identity. `getDatabaseBinding` continues to report that path, verified device/inode and instance epoch. Memory identities use the normalised workspace/store/data tuple with a `memory:` prefix. The prefix already distinguishes memory from file keys, so the redundant stored `dbMode` projection is removed. File binding and backup guards use the existing actual file-identity marker.

Repeated identical snapshots reuse the valid connection. A different target/mode throws `Database bootstrap target changed; close the database before selecting another target.` **before** closing the old handle or unregistering its checkpoint. The old database/binding/data stay usable and no new target is created. Explicit `closeDatabase` unbinds the owner before a trusted caller selects another target; this is not an automatic migration or operational permission.

The existing test-harness detector permits the supported isolated memory→memory fixture identity changes. Memory→file/file→memory changes still require explicit close. A non-test memory owner also rejects implicit scope changes. Owned tests verify the non-test branch by changing only their disposable child's argv, then restoring it. No new test bypass flag is added.

Root role policy, valid-handle probe, same-target stale-handle recovery, file identity, FK restoration, schema transaction/ledger, backup verification and checkpoint lifetime remain at their existing boundaries. The live-database test guard receives the selected snapshot workspace; it does not consult an unrelated frozen workspace for that decision.

## Removed paths and measure

Before: `initDatabase → config-context.getRuntimeBootstrapPathOverrides → readRuntimeBootstrapPathOverrides` for mode/cache, alongside an independently frozen `STORE_DIR` for file I/O. After: `startup/getRuntimeConfigPaths → initDatabase(snapshot)` uses one existing resolver result for the selected boundary.

Policy-free raw-override forwarder1→0; duplicate stored mode projection1→0; selected independent path/mode sources2→1. The underlying raw reader remains for real resolver/runtime-root consumers. No new config/provider facade, migration framework or global getter conversion is added.

Stable #1270 measure at the final integration base: **144,517→144,515 physical**, **134,115→134,114 nonblank**, **712files unchanged**: **−2physical/−1nonblank**. The mode expression moves within the measured roots and earns no movement credit. Added binding checks/snapshot field are charged; there is no outside-root replacement implementation. Tests/docs/typing supply no independent deletion credit. [Machine receipt](receipts/database-bootstrap-snapshot-1275.json).

Tracked/ignored/type/dynamic/package and approved ad7 source audit finds no production consumer of the retired forwarder. Two approved add-on integration tests still call the supported no-argument `initDatabase`; that default remains. Existing path constants and unrelated domain-reader APIs are retained.

## Verification

The original defining file gives1pass/4fail, including wrong actual file before init, ignored supplied snapshot and silently accepted mode/target changes. The obsolete forwarder import fixture also fails before its exclusive expectation moves directly to the existing raw reader; all raw precedence/trim/sentinel assertions stay.

Six owned subprocess cases assert real `PRAGMA database_list` paths/bindings, pre-init mutation, captured-snapshot stability, repeated init, refused post-bind target/mode changes with usable old rows/no new file, explicit close/rebind, both memory flags, store sentinel, test memory identity changes, non-test memory refusal, CLI precedence and real file-backed backup/memory backup rejection.

Focused evidence:23cases/91assertions across bootstrap/config/connection/in-memory files; runtime startup4/15; disk startup6/12; schema/cache18/75. All three source type projects and strict new fixture types pass; actual native default-factory events1/182 passes. Existing import findings remain25byte-identical pre-existing violations, not green. Environment observation metadata is refreshed for the mode-reader relocation using unchanged scanner roots and direct-name baseline; no functional reader-removal claim or acceptance-baseline change follows.

## Hosted fixture correction

Initial CI40787779998 reported26host failures after7,092passes. Four fixture families relied on frozen store constants or implicit mode changes: media/auth blockers could target a different database, the historical restore copy could land in a different store, and file queue fixtures could switch away from a still-open memory owner. Direct and owned import-order-seeded runs reproduce all four causes.

Fixture-only corrections bind WAL contenders to the actual verified file and assert both `PRAGMA database_list` paths, use an explicit owned snapshot for the copied-profile reopen, and close before selecting a file owner. They stop deleting an unrelated frozen harness database. All original contention/cancellation/revocation/atomicity/replay/data/identity assertions and timeouts remain; actual-path assertions are added. The media binding helper is imported from its real connection module, with the initial incorrect-import log retained. Corrected26cases/271assertions pass, including the seeded order that failed before. No production guard is relaxed or repaired automatically.

## Rollback and operational boundary

The snapshot and guard change no stored schema/data, source IDs, grants, SDK history or checkpoint policy. Reverting can restore the old mixed-lifetime behaviour; no data rollback is required. Unsupported live file/workspace migration still needs separate design and permission.

This source-only change performs no installation/restart, dependency upgrade, live configuration/data/schema operation, backup/restore promotion or branch/worktree cleanup. Automatic repository CI, author review, authorised merge and final exact-head revalidation remain required before #1275 acceptance. Prior #1696/#1697 role/checkpoint work receives no duplicate credit.
