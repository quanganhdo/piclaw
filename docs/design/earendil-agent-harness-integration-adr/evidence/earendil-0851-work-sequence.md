# Published 0.85.1 work sequence and approval boundaries

The selected implementation target is **published 0.85.1 in Piclaw's existing coding-agent loop**. Broader Harness capability completion and later-release reassessment are separate work streams. This scope refinement preserves tested partial evidence; it neither rewrites branch history nor authorises activation.

## Coordinates and historical records

| Record | Coordinate | Use |
|---|---|---|
| Production Piclaw baseline | `ad922bdaac40b3a5119aa3017a10ee63897e318b`, exact Earendil 0.84.4 | Deployed baseline at this handoff; unchanged |
| Selected published candidate | 0.85.1, `d981de1229ef899957bbe968bc8dcda02a21f477` | Current-loop migration and its public compatibility evidence |
| Separate planning tip | `e4c75a73222ae2c72abb5f5314fa35ee8effc508` | Independent source comparison only; 85 commits / 387 files / +25797/-9291 beyond release |
| Earlier dev / #8963 capture | `d14d6b22327d545d6a253f932165b63e48d7f9c8` | Historical 1 September assessment, not the active candidate |
| Earlier release negatives | 0.84.1 / 0.84.4; rejected 0.85.0 | Preserve original observations, fingerprints and failure reasons |

The original assessment installed a coding-agent-only consumer with Bun, then imported that same dependency tree separately under real Node 26.7.0 and Bun 1.4.1. That was not a Node/npm install or minimum-engine proof. Later independent probes added real Node 22.19.0, the declared minimum, and passed. No runtime/profile reconfiguration was needed.

## PR scope separation

| Work | Scope | Delivery / gate |
|---|---|---|
| A — [#1330](https://github.com/rcarmo/piclaw/pull/1330) | Package admission and provider/API/model catalogue comparison, with live pins unchanged | Published and locally validated; unmerged |
| B — [#1331](https://github.com/rcarmo/piclaw/pull/1331) | Atomic exact 0.85.1 current-loop/ExecutionEnv/tool/fake migration; direct selected-release assignments, basic positive compatibility and public Memory/JSONL SessionRepo conformance | Draft; bounded tested HC evidence stays in B and is labelled partial, never complete promotion |
| C — [#1332](https://github.com/rcarmo/piclaw/issues/1332) | Broader deterministic Models/tools/fault controls, real-constructor full HC execution, crash/reopen/replay/memo/checkpoint/queue/abort/structural/event-fold coverage | Tracked future completion work; truthful pass/fail/unsupported catalogue, still inactive |
| D — [#1333](https://github.com/rcarmo/piclaw/issues/1333) | Reassess relevant tip-only changes after a later coherent published release | Deferred; no tip source bump or backport implied |

PR B's tested partial HC cases are retained as migration evidence. PR C owns broader completion beyond that bounded proof. Missing HC promotion is not relabelled as a pass or silently waived by scheduling C. Nothing in A–D authorises a production Harness importer, barrel, registration, activation flag or new authority boundary.

## Release versus tip

Shipped in 0.85.1: immutable Context, trailing-context filesystem/shell operations, six-argument tools and durable invocation memos, AgentLane, lane watch, events and usage. These do not require Git-tip adoption.

Excluded from the 0.85.1 contract: `FileSystem.openTextLineReader`, `TextLine`/`TextLineReader`, `NormalizedRetryPolicy.maxAgentDelayMs`, changed fork-policy helpers, `createSessionRepoStreamingForkConformance`, mid-conversation `SystemMessage.replace` and forced-prompt replay. Other tip-only sampling, compaction and registry APIs also remain outside B. SQLite streaming-fork parity is incomplete at tip; tip tests are not release acceptance tests.

The coding-agent root and shipped `./rpc-entry` are supported published surfaces. `./client` and `./experimental/plugin` have source-only export conditions and fail in the packed consumer; they are excluded. Corrected closure removes the obsolete requirement that pi-server become transitive. A fresh supported closure with no workaround is the gate, not merger of the old upstream proposals.

`watchSession` advertises `WatchHandle<SessionSnapshot>` in the public interface, but the concrete release and pinned-tip implementation throws `SliceNotImplemented` and declares `Promise<never>`. Lane watch is implemented; neither declaration presence nor successful root import proves session-watch support.

## Service ownership is unchanged

`ServiceWorkStore`, `TerminalSettlementStore`, `ServiceOutboxStore`, `ScheduledRunStore` and `AgentProjectionSink` keep authenticated acceptance, exact operation/version/cancellation, source frontier, terminal/timeline/media, external idempotency and delivery authority. Correlate Piclaw `operationId` with `harnessOperationId`; Harness events/results are evidence inputs, not independent settlement or frontier authority. Cache-reporting and provider-cost provenance remain Piclaw facts.

Historical `fiveArgumentExecution`, seven negative compiler checks, 25 `HarnessNotImplemented` outcomes and 0.84 fingerprints remain explicitly historical. The seven compiler checks include missing exports and incompatible signatures; they are not seven newly missing release exports. Selected imports use `MemorySessionRepo` and `@earendil-works/pi-agent-core/harness/session/testing`.

## PR B merge and rollback gates

Before B merges, require its reviewed atomic migration, current-loop compatibility and public Memory/JSONL evidence, plus an **authorised disposable microVM upgrade/restart/rollback receipt**. Rui subsequently authorised piclaw-test and accepted public SessionRepo scope on 17 September 2026. The [targeted canary receipt](earendil-0851-canary-result.md) records the executed upgrade/restart/rollback, exact checkpoint restoration, passing browser/tool checks and remaining limits. Future runs must revalidate target/use and authority; none is inferred from this work sequence.

Rollback restores the exact baseline 0.84.4 runtime/dependency set as one atomic change. No production schema migration or session rewrite is intended. Synthetic candidate-written test state must be handled according to the explicit canary rollback strategy; do not assume downgrade readability. Production `.piclaw` state is never a disposable fixture.

The [readiness record](earendil-0851-readiness.md) retains raw Storage export/scope limitations, baseline lint/hosted failures, non-Linux coverage and remaining approval gates. No merge, deploy/restart, paid-provider call, data migration or spending allowance is granted. The canary approval did not grant merge or production deployment authority. The remaining acceptance decisions stay explicit; this sequence does not mark full adoption complete.

## Historical reading guidance

The pinned captures in `earendil-harness-v3-assessment.md`, the 0.84 surface/constraint documents, and their recorded commits remain unchanged. Statements about `dev`, #8963 or the released-v2 scaffold in those captures describe their recorded dates. Current navigation and selection policy use this release-pinned sequence instead. Repository examples resolve beneath `/workspace/piclaw` or an owned worktree, not directly beneath `/workspace`.
