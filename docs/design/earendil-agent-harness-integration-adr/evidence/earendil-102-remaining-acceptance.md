# Pi 1.0.2 acceptance checkpoint

Released Pi 1.0.2 and adapter server Settings are merged and qualified for Piclaw's retained-wrapper source lane. Production Delegate activation, live account/server tests and operational rollout are unfinished. Adapter/Auto remains the default; unsupported Native selections fail closed. Native replacement and pi-durable are outside this integration.

Target: upstream `cd32f7725fdbddbaecdff5b1e68491563394e0ca`. Core source: `d26e9b7858895d883f36c88d2e8ab2377643b662`. Adapter runtime: `dddfcf630508f42c169889c11dee94e69b746e7c`. All new checks use Bun 1.4.2 and disposable synthetic state. The installed service has not been changed by this work.

## Merged source and exact checks

| Slice | Result | Boundary |
| --- | --- | --- |
| [Core PR1549](https://github.com/rcarmo/piclaw/pull/1549) | Exact released packages and fresh provider/CLI/UI receipts; full 6,347 pass, eight skip, zero fail; postmerge 24 tests / 1,065 assertions | [Migration evidence](../../../development/pi-102-integration.md); separate from installation |
| [Settings PR1550](https://github.com/rcarmo/piclaw/pull/1550) | Frozen head `04d6c9917`, tree `edbb79d707`; full 6,456 pass, eight skip, zero fail, 42,138 assertions; features 25/246 and web 9/26 | Documentation-only publication `42b9058b6` has runtime/dependency/test/script parity; merged tree `9a6aa80fe5` matches |
| Hosted Settings CI | [37286187765](https://github.com/rcarmo/piclaw/actions/runs/37286187765) succeeded on exact `42b9058b68a195e361ad922d18d9e9708cd7790e` | Canonical fast gate, Chromium/WebKit SVG acceptance and isolated Git-install smoke passed; no live installation |
| Settings security/runtime/UI | Integrated 203 tests / 852 assertions; both skins in Chromium/WebKit 14 / 590; postmerge 138 / 449 | [Reviewed server qualification](../../../reviews/mcp-adapter-server-settings.md) covers preview, credential/configuration binding, reload and saved-but-not-activated failures |
| Final core integration slice | 100 tests / 405 assertions, zero failures on frozen installed `d26e9b785` closure | Models, auth error isolation, MCP owner/policy, sampling precedence, request reservations and inactive host/shared-boundary fixtures |
| Wrapper capability slice | 316 tests across 21 files, zero failures on a copy of the exact frozen installed adapter | Prompts, resources, Apps/UI messages, schema/output guards, selected policy, sampling/elicitation and OAuth-provider tests; synthetic loopback transports |
| Wrapper auth | 144 tests across five files, zero failures with the reviewed callback fixture correction | Runtime unchanged; explicit test-only correction described below |
| Current provider auth/receipt slice | 24 tests / 1,060 assertions passed; one existing opt-in crash scenario skipped | Public lifecycle/cross-process/external-auth and exact artifact/UI receipt validators. Skipped process-loss coverage has no new pass |
| Disposable rollback | Pi 1.0.1 → 1.0.2 → restored 1.0.1 passed; snapshot bytes verified, post-cutover writes quarantined | Stopped-writer SQLite WAL/FULL, public session JSONL and reference-only config; no live accounts, token rotation or core/add-on deployment |

Machine-readable [checkpoint receipt](../../../development/receipts/pi-102-acceptance-checkpoint.json) records exact hashes, outcomes and scope. The eleven historical 1.0.1 JSON artifacts retain their original bytes.

## Retained-wrapper MCP criteria

“Scoped pass” applies to the listed source/synthetic execution. A live requirement or production child integration has its own unfinished gate.

| Requirement | Current evidence | Remaining gate or disposition |
| --- | --- | --- |
| MCP-01 package admission | Scoped pass: eight exact released archives, installed payloads, public imports and family closure | Source admission complete; deployment separate |
| MCP-02 configuration and precedence | Scoped pass: public virtual preview, highest project override, inherited removal, stale revisions and committed/lower-source identity binding | Server editing source complete in PR1550 |
| MCP-03 credential ownership | Scoped pass: generation-scoped keychain bridge, immutable server env, secret withholding, credential destination/rebinding denials and adapter auth storage | Native credential-store replacement is future scope; live keychain/OAuth unchanged |
| MCP-04 exposure/filtering | Scoped pass: include/exclude policy before transport, proxy metadata policy, required capabilities, sole owner and unsupported-Native refusal | Full Native parity is future scope |
| MCP-05 execution/tool policy | Scoped pass: direct/deferred/codemode public pipeline, nested hooks, parent IDs and model execution disabled | Model execution inside codemode requires a qualified paid-request boundary |
| MCP-06 resource policy | Scoped pass: resource capability/materialisation, tool policy, text/image content and UI-resource negative cases | Real-server resources and Native resource-filter contract separate |
| MCP-07 deadlines | Scoped pass: host transition deadlines, bounded bodies/results and failed/hung cleanup fences | Native progress-reset deadline semantics are future scope |
| MCP-08 lazy/socket lifecycle | Scoped pass: adapter configuration preserved; binding, reload, single-owner/process and final disposal fixtures | No new live socket/server deployment |
| MCP-09 replacement and cleanup | Scoped pass: public shutdown acknowledgement, no replacement after failed cleanup, captured-prompt fences and preserved history | Actual production provider/auth tails are a separate Delegate contract gap |
| MCP-10 headless OAuth | Scoped pass: wrapper auth-start/complete, state/callback/cancellation, URL/provider isolation and refresh/logout fixtures | Corrected callback-port fixture overlay is explicit; real server/account OAuth not run |
| MCP-11 prompts and Apps | Scoped pass: real SDK prompt fixture, arguments/errors, resource/App UI origin/session/message and output tests | Live Memento prompts/Apps separate; Native prompt/App replacement future scope |
| MCP-12 status/management | Scoped pass: owner-only GET/preview/Apply in both skins, selected/persisted state and fixed redacted diagnostics | Connection status remains explicitly unknown where no observer exists |
| MCP-13 Delegate MCP | Scoped denial: inactive child host describes `mcp: 'none'` and rejects required MCP before work | Production child generation/capability propagation unfinished; add-ons160 open |
| MCP-14 live Memento | Not run: offline server fixtures only | Separate real-server permission and bounded allowed-call list required |
| MCP-15 removal/rollback | Retained adapter is approved scope; disposable snapshot restore passed | Removal is outside this integration; live core/add-on/token rollback unfinished |

## Provider authentication criteria

| Requirement | Current evidence | Remaining gate or disposition |
| --- | --- | --- |
| AUTH-01 methods/inventory | Scoped pass: fresh 42-provider/nine-OAuth public inventory, custom/external distinctions and separate OpenAI/Codex identities | Arbitrary composed/custom production routes need their own supported plan |
| AUTH-02 packaged flows | Scoped pass: fresh exact packaged CLI OpenAI/Codex execution, artifact fingerprints and synthetic SDK login | Production authentication middleware and required real-account login separate |
| AUTH-03 interactions | Scoped pass: fresh 22 device, six Codex-device, 20 browser, 17 Anthropic copy-code and ten private-UI cases | Complete supported-account live interaction matrix unfinished |
| AUTH-04 lifecycle/ownership | Scoped pass: public persistence/reopen, rotation, concurrent refresh, cancellation, scoped logout and redacted stream errors | Public raw auth-task completion/account-generation contracts absent; live revocation/rotation and opt-in crash replay not newly qualified |
| AUTH-05 privacy/isolation | Scoped pass: private UI 1,342 assertions, cards/rows/recordings/exports, per-server leases and credential-free synthetic parent IPC | Production Delegate env/credential delivery and broader historical/external trace coverage unfinished |
| AUTH-06 external/custom sources | Scoped pass: stored/ambient precedence, public cloud/local probes, invalid key preservation and effective remaining auth source after logout | Real cloud/bootstrap and arbitrary composed-provider coverage unfinished |
| AUTH-07 Delegate | Partial synthetic foundation/fail-closed evidence: approved model gates, no fallback fixtures, current public types and inactive host/reservations | Parent/child credential-source agreement, fresh account authority, broker/raw settlement and child MCP transport unfinished. Exact immutable Delegate/core compatibility, exposure/family policy, credential scans, sole owner and orphan-process cleanup require final qualification; add-ons160 open |
| AUTH-08 rollout/recovery | Disposable compatible-state snapshot restore and later-source offline receipts pass | Deployment/restart, real-account canary/soak and rotated-token rollback need explicit approval and evidence |

## Callback fixture correction and retained failures

A new audit initially used canonical main's stale local adapter installation (`2400aec`) despite the new source pin. Its config-write test failed because the old adapter ignored the virtual preview argument. A detached `d26e9b785` worktree with `bun install --frozen-lockfile --ignore-scripts` installed the approved `dddfcf6305` closure; the unchanged combined slice then passed 100/405. Canonical dependencies and the running service were left untouched.

The installed adapter's three callback-port conflict cases failed under Bun 1.4.2. A minimal `node:http` probe bound successive `localhost` listeners to IPv6 and IPv4 on the same port. Explicit same-family collisions rejected. The test-only [adapter PR11](https://github.com/piclaw-bot/pi-mcp-adapter/pull/11), merged as `c7f8c1ccb9270bb247cffa4350d47881669533c3`, occupies both available loopback families, tolerates only unsupported IPv6 errors and removes an early conflict return. Original assertions/deadlines and all runtime files are unchanged. Corrected auth: 144 passed; strict TypeScript passed; independent corrected-diff review clear; postmerge callback cases 27 passed. No hosted checks were reported for that PR. Core retains its exact `dddfcf6305` runtime pin; the acceptance run overlays only the corrected fixture.

The first ad-hoc wrapper runner also used nonexistent test filenames and an incompatible TypeScript 7 compiler API. Its pre-collection failure supplies no qualification. A separate copy of the qualified installed adapter uses TypeScript 5.9.3 solely for its test transformer, preserving the frozen core execution dependencies. Failed logs, old-target receipts and earlier full-gate failures stay retained locally.

## Measured resource coverage

| Workload | Measurements | Limits |
| --- | --- | --- |
| Released public SDK MCP fixture | Eight actual child runs, including two CPU profiles; 14 responses/reload/disposal and zero network attempts | Candidate-only SDK workload; no DB/live-provider baseline |
| Settings read/preview | Fresh 100 requests/25 servers: wall 148.21ms; CPU user 139,439µs/system 15,640µs; event-loop max 16.34ms, p99 9.90ms, 52 samples; 1,051 parses, 650 serialisations, 250 SQL queries | Synthetic direct owner handler; excludes HTTP/CSRF/keychain/Apply/provider cost |
| SQLite startup | Comparable WAL/FULL profiles and equal schemas; fresh median 7.558s→0.396s, legacy seed 8.605s→0.259s | [Schema transaction evidence](../../../development/sqlite-startup-schema-transaction.md); final VACUUM, busy bound and durability unchanged |
| Request ledger/host/shared boundary | Owned synthetic CPU/event-loop/SQL/serialization receipts with repeated plain/instrumented runs | Earlier 1.0.1 profiles retain that target; current 1.0.2 correctness rerun supplies no new performance comparison |
| Broader performance audit | Auth/queue/retention/context fixes and individually measured workloads are recorded separately | Mixed steady-state/background/large-history parsing/heap/GC remain incompletely measured; no whole-system performance acceptance |

## Release decision

Source Settings and retained-wrapper compatibility gates pass within the recorded synthetic scope. Combined production acceptance under #1455 is incomplete. Pi 1.0.2 public terminal events and `result()` still do not acknowledge raw provider/authentication settlement; [upstream10461](https://github.com/earendil-works/pi/issues/10461) was auto-closed by contributor policy. No fix is established. The parent host and shared installer remain inactive, with no production registration or credential/account bridge. Final Delegate qualification also needs matching immutable core/add-on provenance, exposure/family policy, credential scans, exactly one MCP owner and orphan-process cleanup. No private SDK workaround is accepted.

Core #1458/#1455/#1456, add-ons160 and epic1442 stay open for applicable outstanding criteria. Source merges do not grant installation, restart, real credential/provider use or expenditure. The next operational decision needs separate permission for the named artifacts, allowed account/server calls, soak duration, stop conditions and rollback handling. Post-cutover writes must be preserved and reconciled; the disposable drill quarantines them and does not replay them automatically. Superseded OAuth refresh tokens must not be blindly restored.
