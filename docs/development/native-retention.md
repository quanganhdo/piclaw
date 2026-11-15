# Native retention ownership

Retention has separate owners for history, replay evidence and derived observations. Checkpoints, WAL truncation and freelist reclamation do not retire logical records. This change adds no production retention timer, operator deletion permission, schema migration, generic cascade or SDK-table deletion.

## Eligibility and retained exceptions

| Class | Owner and eligibility | Reference invariant |
|---|---|---|
| Immutable/imported history, document families and revisions | SDK/public document owners; retained | Preserve entries, conversation branches/inheritance, original imports and provenance. Public `Tx.retireDoc` retires a specific owned document incarnation logically; it does not authorise SQL deletion or physical history pruning. No generic physical pruning API is available in the pinned SDK1.4 contract. |
| SDK tasks/submissions/record IDs | SDK; retained | Queued, placed, completed and unanswered identities remain available for reconciliation. Compaction is not historical retirement. |
| Native accepted inputs/bindings/terminal ledgers | EF-S01/S02 plus native bindings; retained | Stable requests, claimed sources, selected attached submission and terminal evidence cannot disappear. Failure receipts and unknown ownership remain retained. |
| Scheduler occurrence detail | EF-S07 `planRetention`/`applyRetention`; bounded opt-in compaction | Only terminal repeatable execution with no native operation binding, opaque result reference, linked host history, current paused successor, pending/started/unknown/retryable outbox link or unresolved scheduled budget request. Existing tombstones, task revisions and successor/replay identity survive. |
| Outbox/effect uncertainty | EF-S05; retained by this policy | No dispatch, retry, reconciliation, unlink or deletion. Unknown delivery remains unknown. This maintenance never calls terminal-outbox cleanup to discard its idempotency scope. |
| Budget work, request holds, events, lineage and valuation | Accounting owners; retained | Reserved/dispatched/unresolved capacity, event/request identities and settled charge evidence are never released or revalued by report pruning. |
| Anonymous legacy usage reports | Reporting owner `usage-report-retention.ts`; bounded opt-in plan | Canonical old timestamp; no named event/invocation, work identity, event/request link or recorded accounting window covering its timestamp. Work-owned legacy reports and recorded windows can remain the sole source of lifetime/calendar budget spend even without unresolved requests. Missing named evidence and malformed dates stay retained. |
| Native tool-output files/metadata/FTS | Tool-output owner; retained pending a complete reference-retirement proof | Handles/full paths can survive import, compaction and active work. Missing registration or age alone cannot prove orphanhood. Native-owner presence holds row/file pruning and flat-path migration. |
| Media, Codex images, answers and saved reviews | Their existing owners; retained | Message/operation/outbox references, immutable image proofs, native side/answer caches, saved source/revisions and receipts survive. No orphan inference from a single join table. |
| Derived UI/search/reporting state not covered above | Its existing projection owner; retained | Rebuildability alone does not permit deleting the only payload or the identities needed to rebuild it. Native UI projection retirement remains #1692. |
| Configuration, credentials, schema/migration receipts | Their existing owners; retained | No value lookup, mode transition, credential pruning or ledger rewrite. |

The production startup previously launched legacy file-age cleanup **before** native history/import preflight. That registration is removed. Explicit legacy cleanup APIs remain for compatibility; the new native maintenance policy does not invoke their file sweeps or reinterpret their age policy. Native tool-output retention fails explicitly when called directly. Calling the legacy start API after native bindings exist records a hold without creating a timer; production startup does not register that API. If registration enumeration fails, file-only pruning raises an error instead of treating every path as orphaned.

## Usage-report pages

`planUsageReportRetention(database, {before, after?, limit?})` returns a version-1 dry-run plan. `limit` is at most1000 **examined records**, including protected/recent/malformed rows. IDs form a stable keyset; no offsets or wall-clock changes inside a sweep. The plan contains a fixed set of eligible row IDs, content fingerprints, serialised-byte accounting, examined high-water mark and next cursor. It contains no report contents.

Persist that exact plan before calling `applyUsageReportRetention(database, plan, validate?)`. Application validates every present row/reference before the first DELETE in one immediate transaction, then revalidates owner authority before commit. A stale report or new hold rejects the entire page. Reapplying the same plan after a lost ACK returns already-absent IDs; it cannot spill into the next page. Suppressed deletes are reported as blocked and prevent cursor advancement. Accounting reports actual direct deletes, not trigger-amplified Bun change counts.

The existing `pruneOldTokenUsage(days)` startup call now processes one page. Its frozen cutoff and cursor live under `router_state['retention:legacy-usage-reports:v1']`, atomically with deletion. Refused cursor publication/removal rolls back the page. Corrupt cursors or a clock moving behind the frozen cutoff fail closed. An explicitly changed age policy starts a new sweep; finishing clears its cursor. No timer or policy default is added. Explicit per-page plans remain the interface for maintenance ACK replay.

A later sweep starts from zero so previously protected records and backdated inserts can be reconsidered. Advancing past a hold never grants future permission to delete it.

## Scheduler pages

The SQLite scheduler owner exposes:

```ts
const plan = await scheduler.planRetention({ settledBefore, limit: 100, after });
// Persist the successful plan, inspect its selected IDs/accounting, then:
const applied = await scheduler.applyRetention(savedPlan);
// Advance to savedPlan.nextCursor only after an acknowledged success.
```

Plans examine at most100 terminal candidates ordered by `(settled_at,run_id)`, including retained candidates. Dry-run makes no mutations. Exact selected records and page positions are captured before awaiting the existing serial mutation lane.

Application checks all eligibility/content proofs inside the owner's transaction before compaction. It reuses the existing tombstone protocol, fault boundaries and `service_effect_s07_decisions` receipt store. A plan hash namespaces the receipt. Tombstone suppression, deletion suppression or missing success-receipt publication rolls back the page. Lost ACK/reopen returns the same result without retiring another batch. Old `cleanupTerminal` request keys, hashes and receipt decoding remain compatible; exact existing decisions still replay. Fresh native requests through that older selection API fail with `invalid_transition`: they must use an explicit plan. Its generic compatibility path also retains pending/started/unknown/retrying delivery links. The new policy has a separate plan namespace and never silently reinterprets an old request.

The API registers no caller or schedule. Native-bound occurrences, unresolved effects, opaque results and host payload/history references are retained even if expired. Reconciliation, grants, budgets and actual command execution remain outside cleanup.

## Measurement and recovery

`runtime/scripts/lib/retention-storage-inventory.ts#measureRetentionStorage` accepts an explicit sealed offline snapshot, checks the existing schema-ownership contract and reports per-class row counts, logical stored-value bytes and `dbstat` allocated pages when available. Missing `dbstat` is explicitly reported; other failures propagate. Shadow-table payloads are excluded from logical counts to avoid double counting. Page allocation is reported separately. No file-size reclamation is inferred from row deletion.

The real native fixture starts with ordinary/attached-steer/side turns, public imported history and manifest, saved review/image state and an unknown outbox effect. It creates a disposable candidate with old reports, an unresolved scheduled hold, sole legacy lifetime/calendar spend observations, cache/media data, opaque results and host-linked scheduled history. Only eligible report and scheduler detail pages are retired. It fingerprints retained history/IDs/ledgers/holds/cache/media/review state, measures sealed before/after snapshots, captures a new complete recovery unit and reopens it with SDK scheduling paused and credential access denied. No model or effect replay occurs during maintenance.

Current disposable measurements are evidence about that fixture only. Keep the matching complete [native recovery unit](native-recovery-unit.md) before operator maintenance. Failure preserves the source unit and disposable candidate; no automatic retry, live backup/restore, promotion or service restart is provided. Restoring older software also requires its matching storage-format checkpoint; SDK1.3 cannot open SDK1.4 format2.

## Focused qualification

- `runtime/test/db/usage-retention.test.ts`: bounded examined/deleted pages, dry-run, lost ACK/reopen, progress through protected rows, immutable accounting, new accounting references, retained lifetime/calendar spend, stale data, cursor refusal/corruption, malformed data and atomic faults.
- `runtime/test/service-effects/scheduled-run-retention.test.ts`: owner pages, persisted receipts/tombstone replay, caller mutation, opaque/pending/unknown references, legacy API bypass refusal and rollback at each compaction boundary.
- `runtime/test/db/native-cache-retention.test.ts`: retained native files/metadata/FTS, fresh-startup ordering and failed reference-inventory refusal.
- Existing registered default-factory case `native-retention-unit`: actual native/import/review/unknown-effect restore, per-class measurements and post-maintenance paused recovery. No new native test filename is introduced.

Run only these defining cases and directly affected fixtures through the isolation/priority launcher, plus relevant types/static checks. Focused success does not establish a full hosted-suite result or authorise production activation.
