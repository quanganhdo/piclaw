# MCP codemode settings qualification

Adapter codemode settings now apply through the owner-only backend in Classic and Visual. Native engine replacement lacks qualified shutdown and capability contracts, so its Apply path rejects explicitly. Relates to #1451; server/auth management and native parity are unfinished.

## Implementation

- `mcp-codemode-runtime.ts` selects immutable instance policy, loads public Pi 1.0.1 scripting with `models: false`, fences captured prompts/tool calls, and applies codemode through public active-tool APIs.
- The controller fences admission, drains lifecycle work, deduplicates main/side participants, aborts active turns, rechecks owner authority and config/bridge revisions, commits the policy, updates active tools and resumes.
- Sessions retain their identity, history and unrelated active tools. Codemode changes retain the existing adapter owner and transports; they do not reload extensions.
- Random preview tokens expire after five minutes and are bounded to 128 entries. A transition has a 30-second asynchronous deadline. Failures keep admissions blocked; saved-policy/failed-activation responses distinguish persistence from successful activation.
- Both panes require a compatible preview and explicit interruption acknowledgement. Selection changes invalidate previews and acknowledgement. Active Apply locks selection and request controls.
- Native diagnostics use the ten exact 1.0.1 public-contract gaps plus the separate suppressed-close probe. Connection status is explicitly unknown. No fallback, private shutdown-handler invocation or native waiver is provided.

## Completed evidence

| Check | Result |
|---|---|
| Expanded focused controller/routes/planner/bridge/admission/guard tests | 89 passed / 548 assertions |
| Post-retention focused gate at `84ce5ab69` | 31 passed / 286 assertions |
| Updated browser-only matrix | 10 passed / 414 assertions; both skins, Chromium/WebKit, 1280/390 widths and actual settings navigation, existing compiled CSS |
| Web rebuild and rebuilt browser replay | 9 web checks / 26 assertions, then 10 browser tests / 414 assertions in 10.08 seconds; stale-dist passed |
| Actual Pi 1.0.1 in-memory scripted-provider fixture | Current/new sessions, scripting, nested policy, disabled models, Off enforcement and preserved identity/history passed; enforced zero network/child attempts |
| Five repository typecheck stages | Passed; 95 pre-existing frontend transitive diagnostics unchanged |
| Actual Piclaw `createSessionInDir` / bundled adapter integration at `071e484ba` | 4 passed / 32 assertions; eager stdio ownership, policy/quarantine and proxy registration retained |
| Strict standalone Visual MCP component/shared-controller compilation | Passed |
| Scoped lint; silent-catch/logging/cycle/test-entrypoint checks | Passed |
| Separate @github source review of controller/handler | No confirmed blocker; hanging-abort and resume-refusal regressions requested, added and passed |
| Separate @github final shared-controller/Classic/Visual review at `40112de02` | No confirmed UI blocker; stale-response suppression, acknowledgement, Apply control locking, exact persisted/observed confirmation and explicit native rejection reviewed |

Two delegate reviews timed out and supplied no findings or approval. Self-review subsequently added a post-resume inspection-failure regression and restored the global captured-prompt fence in that failure path. A type-only local import created a dependency cycle; the host now uses a small structural contract and the cycle check passes. SDK review also found that unchanged active-tool writes rebuild prompts and can reset pending tool discovery. Synchronisation now writes only when codemode membership differs; unit and actual Pi hook regressions pass (14 tests / 60 assertions).

## Final frozen gate

Frozen head `8adecc7fe495cfc57f2cbb5beff9fe7b4aeb139c`, tree `b60882bc32ed8758973fc236c77434d07c039c4c`, passed `make ci-fast` on 4 October 2026: 6,130 runtime tests, eight existing skips, zero failures, 39,925 assertions in 971.20 seconds; 25 feature tests / 232 assertions and nine web checks / 26 assertions. The tree stayed unchanged through the gate. Log SHA-256: `2cf2b319100d2159ee4a2a6aec01e45e55710b495785f23d929cb9a03b7632a9`; local log `/workspace/tmp/mcp-settings-full-v3/ci-fast.log`.

Postgate focused checks passed 33 tests / 292 assertions. All five typecheck stages passed with 95 unchanged pre-existing frontend transitive diagnostics; pack hygiene passed for 24,752 files, and stale-dist passed. Runtime/handler, both UI renderers, no-op discovery preservation and fixture corrections received independent narrow source review. Only this qualification prose changed after the frozen gate; exact source/test/asset parity is checked before publication. No production install or restart was performed.

## Full-gate fixture correction

The first full gate at `c699a9fbb` exposed four failures in production-session thinking and persistence-sanitisation fixtures. Those fixtures inherited the helpers' shared workspace, which an earlier test left with a `0644` configuration. Session creation now reads the MCP policy through the existing owned-private-file check and rejects that fixture configuration. The run was stopped to correct the fixtures; exit 143 and its four failures are retained in `/workspace/tmp/mcp-settings-full/` (log SHA-256 `274157a6b3883bf19eaee404aa3c6e163c896a09337d7b12ee1fe831928f6836`).

An isolated preload creating the same shared `0644` config reproduced exactly four failures, with 22 passing tests. The two affected files now give production-session cases their own disposable workspace, private `0600` config and restored environment; all original thinking/sanitisation assertions are retained. The same preload then passed 26 tests / 128 assertions. Runtime configuration policy and production code are unchanged. Expanded MCP tests passed 91 / 554 assertions, and all five typecheck stages passed with the unchanged frontend baseline.

PR #1539 merged as `469750211`; its tree equals the previously adopted candidate `fa54cc113`. Merging that main head into MCP produced the same committed tree as the first frozen gate before the fixture-only correction. The corrected full gate must pass before publication.

The second full gate at `e7b3a2605` fixed those four failures but ended with one budget restart-persistence timeout: 6,129 passes, eight skips, one failure, 39,921 assertions in 997.88 seconds (exit 2; log SHA-256 `fd5c3fccef9b5a23e5b10052cf21a40074936d1191e32be548bd1bf2ef9704be`). The unchanged test passed alone in 2.62 seconds. Three instrumented child runs attributed 2.49–3.16 seconds to fresh disk initialisation, 4–7 ms to reopening the same database and 75–106 ms to seeding/status reads. The failed child's phase was not captured, so these measurements do not establish its sole cause.

The budget fixture now performs empty-schema setup in a bounded 15-second `beforeAll`; the existing 15-second assertion phase still seeds, closes and reopens the same private disk database. All five durable Settings/slash-status assertions are retained. Every child has its own 14-second kill deadline and is killed/awaited in `finally` before workspace deletion. No schema copy, in-memory fallback, production change or timeout increase was introduced. Independent review found no blocker. The corrected test passed in 155–166 ms excluding setup; combined restart/fresh/empty/existing/rollback/concurrent disk checks passed six tests / 17 assertions. Five typecheck stages and scoped lint passed. A fresh full gate is required.

## Candidate profiling

The [profile receipt](../development/receipts/mcp-codemode-settings-profile.json) records six runs of the updated synthetic preview workload: 1,000 direct handler requests, 100 configured servers and 20 KiB of unrelated config, using disposable disk SQLite with WAL and synchronous=2. Three plain runs took 316.5–400.6 ms (median 323.4 ms). Two method-instrumented runs and one method-plus-CPU run took 275.8–291.1 ms. Mode differences and runner spread prevent a numerical speed comparison. Historical baseline receipts are unchanged.

Instrumented counts were stable: 8,001 JSON parses, 4,000 JSON serialisations, 6,000 SQLite query lookups and 6,000 statement gets. JSON parse/serialisation accounted for about 50–53 ms per run; statement gets took about 15.5–16.4 ms. The event-loop monitor recorded 48–49 samples per run. Batches contain 100 serial requests and five-millisecond inter-batch sleeps, so their delay distributions do not represent independent request latency.

The whole-process CPU profile contains 527 samples, including fresh schema creation and module loading. Aggregated `run` frames dominate (224 samples); `readFileSync` contributes 36, `stringify` 22 and `parse` 21. Bun omitted source URLs, so repeated names cannot identify exact call sites. Fresh incremental-auto-vacuum migration occurred outside the timed request loop. Startup, config reads/parsing and SQL reads still need wider investigation; transaction and lock contention were not measured. The Apply transition itself was not timed. No network, provider or server execution occurred; raw profiles stay local.

The browser fixture keeps one engine resident at a time. The initial attempt failed to find installed browsers under its isolated HOME; explicitly selecting the existing browser cache fixed launch without downloads. The first real matrix passed eight cases and hit two Classic/WebKit 20-second timeouts. The same isolated case passed, then the unchanged full matrix passed 10/414 in 16.05 seconds. Deadlines and assertions were unchanged. Both failure logs are retained locally.

The [browser receipt](../development/receipts/mcp-codemode-settings-browser.json) includes the rebuilt replay, asset hashes and reviewed synthetic Chromium CPU metrics. Both engines passed after the web rebuild; the single-run ready measurements have no comparative baseline.

Earlier preview-only browser/full counts do not qualify this Apply flow. The updated matrix uses real UI/controller/handler/persistence with a synthetic runtime; actual Pi scripting is tested separately. Full production authentication and live MCP transports are outside this component fixture.

No production install, configuration change, provider call, native activation or restart was performed.
