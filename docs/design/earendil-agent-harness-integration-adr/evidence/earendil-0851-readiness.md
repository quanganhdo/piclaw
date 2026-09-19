# Earendil 0.85.1 candidate readiness

The current-runtime migration was merged and the running Piclaw service now uses exact 0.85.1. Rui accepted public SessionRepo coverage for B; the authorised piclaw-test upgrade/rollback and targeted browser canary passed, and the separately tracked baseline abort-endpoint defect was fixed in #1339. Production Harness activation, complete HC promotion and non-Linux execution remain separate.

## Scope and coordinates

- Main/source baseline: `ad922bdaac40b3a5119aa3017a10ee63897e318b`.
- PR A: [#1330](https://github.com/rcarmo/piclaw/pull/1330), `83b42a1be1950241da43ec2f05bb2a54f3c737b7`. Corrected admission/catalogue evidence; no live pin changes.
- PR B is stacked on PR A and selects exact `0.85.1` for pi-agent-core, pi-ai and pi-coding-agent, with the coherent lockfile. Release gitHead: `d981de1229ef899957bbe968bc8dcda02a21f477`.
- MCP adapter remains `715843cd574923880c6a82e30641a0c2dc01c96a`.
- Add-on archive baseline: `6374ed3c85627c590794e44828d13b08587ba46b`; changes to its test peers were disposable only.
- Host: Smith, LXC, user-systemd. Canonical `/workspace`, `/workspace/.pi` and `/workspace/.piclaw` are unchanged. Production source and installed current-loop runtime now use exact Earendil 0.85.1; Harness remains inactive.

## PR scope refinement

The [A/B/C/D sequence](earendil-0851-work-sequence.md) keeps PR B focused on the atomic current-loop migration, selected-release assignments/basic positive compatibility and public Memory/JSONL SessionRepo conformance. Already-tested partial HC cases stay in B; no history rewrite or removal of evidence is required.

[PR C work](https://github.com/rcarmo/piclaw/issues/1332) adds broader deterministic real-Harness evidence. Its [current result](earendil-0851-hc-evidence.md) is 24 partial rows and one unsupported row, never full promotion or activation. [PR D work](https://github.com/rcarmo/piclaw/issues/1333) reassesses tip-only changes after a later coherent release. Rui accepted the SessionRepo evidence scope and authorised the [executed canary](earendil-0851-canary-result.md).

## Implemented migration

Every migrated Harness filesystem/shell adapter operation uses the released trailing Context, with cancellation from `context.abortSignal`. The adapters, local/SSH factories, independent fake, shared contract and tool tests moved together. Six-argument tool tests preserve Piclaw authority separately from Harness operation/invocation/turn identity, awaited memo writes/deletes and rejection of expired capabilities.

Shell execution uses bounded capture, source updates and metadata-only results. The adapter validates snapshots, output fragments, cumulative replay, byte/line limits and Unicode slide boundaries; it rejects post-cleanup admission and late updates. Rejected environment candidates are cleaned with their receiver. Cleanup is idempotent and safe against synchronous re-entry. Fake process waits settle on timeout, abort and cleanup without a test-only release.

Review findings were fixed and regression-tested, including valid upstream head truncation when both the first line and line count overflow. Final bounded adapter review found no remaining blockers in that scope.

The three-file latent compatibility allowlist and AST/module-graph no-production-import guard remain enforced. Available preparation types are aliases to released public exports. No production AgentHarness constructor, registration, activation flag, watchSession call or pi-server dependency was introduced.

## Executed local gates

Counts in separate rows overlap. They are executions from specific commands, not an additive unique-test total.

| Gate | Result |
|---|---|
| `bun run typecheck` | Pass: runtime, scripts, web Settings and panes |
| `make ci-fast` follow-up | 5,345 runtime passes, four existing skips; 25 feature passes; both frontend builds; nine web-build passes |
| Entire service-effects directory | 375 pass, zero fail, 36 files |
| Real public repository conformance | Memory 17 + JSONL 15 case executions; two catalogue/count checks; 34 tests pass |
| Real public Harness constructor semantics | Eleven tests pass; bounded HC sub-boundaries only |
| JSONL process-loss replay | Four persisted/current safe-never combinations pass across twelve child processes; public SessionRepo/Harness, one specific effect_pending crash point |
| Core read/write/edit/bash factories | Nine tests pass with six-argument calls |
| New offline provider payload/terminal contracts | Four tests pass / 59 assertions: explicit 30m cache payload, legacy 24h, short/disabled caching, EOF Codex response.done |
| MCP/provider/sanitizer/watchdog/portable-script slice | 38 passes across six actually executed files |
| Session manager/compaction/model state/watchdog slice | 68 passes across five actually executed files |
| Affinity/reasoning/cache/token usage/model state/watchdog slice | 29 passes across six actually executed files |
| Add-on compatibility | 125 passes across ten files; compatibility/M365/Remote Peer typechecks pass with all runtime peers and pi-tui at 0.85.1 |
| Standalone add-on import smoke | [46-package matrix](earendil-0851-addon-matrix.md): 42 package-root imports pass; four no-main skill packages have their declared paths present; Linux/Bun only |
| `make pack` | Pass at runtime migration commit `da9098fcf`; no global install |
| Linux x64 and linux-x64-baseline portable builds | Pass at `da9098fcf`; both extract, launch Piclaw 3.1.2 and Pi 0.85.1, and import coding-agent root using bundled Bun 1.4.1. The subsequent import/process-loss evidence change is limited to inactive manifest data, tests and documentation; `da9098fcf` remains the tested artifact revision |
| Fresh coding-agent-only consumer | PR A evidence: Bun 1.4.1, real Node 22.19.0 minimum and Node 26.7.0 pass; no pi-server; source-only imports rejected |
| `make lint` | Fails with the same 20 errors on PR A and PR B; zero new diagnostics after fixing one introduced unused import |
| `git diff --check` | Pass |
| Authorised piclaw-test canary | Exact 0.84.4→0.85.1→0.84.4 with baseline-checkpoint equality, queued follow-up recovery, tool/usage/model preservation, timeout/UI abort, managed compaction and four Classic/Visual browser smoke checks. Original guest restored stopped; see bounded [receipt](earendil-0851-canary-result.md) |

Two full-gate failures were retained and investigated: the candidate's token-usage migration subprocess timed out under load, then passed alone and in repeated full gates; PR A hosted run `35162736970` failed an unchanged queued-lease timing assertion, then passed in three isolated local reruns. Hosted failure is not relabelled as success. No ad-hoc Actions rerun was dispatched.

PR B's automatic hosted check on `da9098fcf` also passed (run `35171352736`). This does not replace the incomplete approval gates.

The disposable add-on compatibility tree initially retained a direct pi-tui 0.84.4 development peer. It was corrected to 0.85.1 and all 125 tests and three typechecks were rerun successfully. The all-package smoke matrix verifies root/nested family versions and entry-point ESM peer provenance separately.

Some initial focused commands named obsolete files which Bun ignored. Only actually executed file/count results above are evidence. Full ci-fast independently discovers its runtime set.

## Historical and selected evidence

The versioned manifest preserves the previous 0.84.1/0.84.4 object under `historical`, including package/fingerprint/conformance hashes and all unsupported HC rows. [Historical negative receipt](earendil-0844-historical-negatives.json) records the seven compiler incompatibilities and 25 HarnessNotImplemented results against their original version; they are not executed or relabelled against 0.85.1.

The selected record contains six-package metadata and contained public-export fingerprints. The broader catalogue now covers HC-001–HC-025 and keeps the original requirements: 24 rows are `partial`, HC-024 is `unsupported`, and none is a full pass. Executed sub-boundaries now also cover manual compaction, retry reattachment with captured policy, deferred resume across reopens, unavailable identities, public restore without duplicate effects, abort/admission ordering and one lane-owned Drive shared by observers. See the [bounded result](earendil-0851-hc-evidence.md).

The follow-up adds real JSONL child-process loss inside an effect_pending tool after awaited memo writes/deletion. Only safe→safe replays; the three other persisted/current combinations publish one interrupted result without invoking the fixture tool again. Tests assert the reserved result ID, stable operation/turn/invocation identity, recovered memos/content, and a third settled process with no repeated fixture invocation or faux-provider call. This covers one defined crash boundary, not arbitrary external exactly-once effects.

Lane-watch coverage now commits an entry before watch.start and waits for buffered delivery; a blocked before_run_end hook prevents drive settlement/run_end until released. Further tests reject an incomplete lane register without changing that register, and compare prompt versus accept-drive transcript/result/queue outcomes for one deterministic turn. Exhaustive crash points, retry/deferred restoration, all compaction variants and other event interleavings remain incomplete.

`watchSession` has a public `Promise<WatchHandle<SessionSnapshot>>` contract; the runtime declaration is `Promise<never>` and its implementation throws `SliceNotImplemented`. It is not called by these tests or production.

### Raw Storage export gate

The public package exports MemorySessionRepo and JsonlSessionRepo, but not MemoryStorage or JsonlStorage. `createStorageConformance` requires an existing Storage fixture; no public helper constructs either built-in Storage. Public Session does not expose its private storage.

A preliminary delegated fixture reached through a private session field and obtained 42 raw-storage executions. That fixture was removed and those results are **withdrawn as admission evidence**. The final suite runs only 32 public repository cases. The JSONL 15-case selection matches the exact pinned upstream `packages/agent/test/harness/jsonl-session-repo-conformance.test.ts`; its two destination-reservation races are not counted as passes.

Planner independently confirmed the export limitation at both the release and pinned tip. Rui accepted downstream SessionRepo plus Piclaw boundary tests for PR B on 2026-09-17 at 06:58 UTC. Built-in raw Storage conformance remains an upstream export/fixture limitation, not an unresolved B scope decision. No private import, property access, copied implementation or declaration trick is an acceptable substitute.

### SQLite boundary

Bun 1.4.1 successfully imports `node:sqlite` and executes an in-memory `SELECT 1`. The selected public session package exports no SQLite backend, and no SQLite backend conformance was run. The historical `bun_node_sqlite_unavailable` label remains history only; it is not the selected-runtime result.

## Approval and execution gaps

- Public SessionRepo scope is accepted. Raw Storage export limitations remain explicit; PR C's 25-row catalogue is bounded evidence, without full promotion or activation.
- Windows, macOS and other native architectures: launcher-generation tests only; no native artifact execution. Current portable builder runs on its host platform, with an additional Linux baseline target.
- The 46-package Linux/Bun package-root import/path smoke matrix is complete (42 imports, four no-main path checks); full add-on runtime/browser/native functionality and non-Linux standalone execution are not covered by import receipts.
- [Canary upgrade/restart/rollback](earendil-0851-canary-result.md) was authorised and executed on piclaw-test. Exact baseline restoration passed; candidate-written-state downgrade compatibility is not claimed. No production schema migration or session rewrite occurred.
- Targeted Classic/Visual browser smoke passed; the full integration/E2E suite and explicit guest UI-prompt/MCP/branch-switch scenarios were not run. The run-abort endpoint defect reproduces on both versions and is filed as #1334.
- Baseline lint remediation or explicit gate disposition; PR A hosted timing failure is still recorded.
- Explicit approval before merge, deployment, restart, paid-provider calls or production-data migration. No spending allowance exists.

`@planner`'s tip assessment is accepted as planning evidence only. No tip-only openTextLineReader, maxAgentDelayMs, forced SystemMessage replacement, streaming-fork helpers, strict sampling, per-model compaction override or ModelRegistry streaming API was adopted.
