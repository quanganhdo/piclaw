# MCP instance settings

`GET /agent/settings/mcp` and `POST /agent/settings/mcp/preview` expose owner-only policy inspection without changing MCP connections. `POST /agent/settings/mcp/apply` applies adapter codemode settings through public Pi 1.0.1 session APIs. Engine replacement remains blocked; a codemode update does not reload or replace the adapter.

All three routes require a freshly resolved single-user administrator principal. Identity is checked after body I/O, before mutation, after participant abort and before publishing. Family and isolated-container modes deny access. Responses are private/no-store; unauthorised requests are rejected before body parsing or configuration reads. Normal HTTP authentication and POST CSRF checks remain in the request guard. The routes share an enforced rate-limit bucket.

## Adapter server routes

`GET /agent/settings/mcp/servers` returns a safe editable projection. `POST /agent/settings/mcp/servers/preview` accepts `{ name, action: "update", patch }` or `{ name, action: "remove_override" }`; `POST /agent/settings/mcp/servers/apply` accepts only `{ revision, acknowledgeInterruptions: true }`. Preview and Apply bodies are bounded to 64 KiB, strict UTF-8 JSON with the same five-second read deadline. The routes share the owner/CSRF/rate-limit boundary above.

Patches change only one highest-precedence project override. Blank form fields preserve current values; explicit null removes a local field and can reveal an inherited value. Preview uses the merged adapter's public virtual-override API. Existing private/advanced fields and unrelated settings/imports/servers stay backend-only and are preserved. Literal arguments/maps/credentials are withheld from GET/preview payloads; keychain and environment references can be configured without returning secret values. Removing an override previews any inherited definition. Disabling retains an inert override.

Changing an effective executable, argument list, working directory, URL or socket cannot carry old credentials. Reference identities are compared across all nested fields and formatting; destination changes with opaque private payloads fail closed when clearing cannot be proved. An inherited field omitted from a local patch is not a credential tombstone.

Server Apply shares the codemode controller's transition phase and captured-prompt fence. It drains both session pools, awaits all public adapter shutdown acknowledgements, commits a private atomic override, hydrates one guarded generation and reloads extensions through an authorised batch/start barrier. The private rename receipt binds committed bytes/identity, unchanged lower sources and exact approved effective configuration through activation. A post-rename mismatch/failure reports saved-but-not-activated and keeps operations blocked. It does not restart the service or clear chat history. The [server qualification](../reviews/mcp-adapter-server-settings.md) records the runtime/browser/security evidence and retained failures.

Preview accepts only `{ "engine": "adapter" | "native", "codemode": "auto" | "on" | "off" }`. Apply accepts only `{ "policy": <same policy>, "revision": <opaque preview token>, "acknowledgeInterruptions": true }`. Bodies are limited to 2,048 bytes, decoded as strict UTF-8, and have a five-second body-read timeout. This is not an absolute deadline for synchronous filesystem/configuration work. Query parameters are rejected. There is no generic save route.

## Response contract

- `persisted.policy` describes desired settings, defaulting to adapter/Auto.
- `runtime.configuredFactory` is `adapter`. `observedPolicy` is the immutable selected adapter policy, or null during a blocked transition or unsupported engine selection. `connectionStatus` remains `unknown`; cached metadata is not connection evidence.
- `readiness` is `{ adapter: true, native: false, codemode: true }`. `applyAvailable` also requires a compatible plan, ready controller and existing adapter selection. Preview acceptance does not apply settings.
- `revision` is a bounded, random, five-minute token held by the controller, not a secret-derived hash. It fences both instance config and the prepared bridge generation. Concurrent edits require another preview.
- `nativeBlockReason` and `nativeBlockers` expose fixed diagnostics for the ten exact 1.0.1 public-contract gaps and the separate suppressed-close blocker, never raw errors.
- `servers[].nativeProjectionStatus` is the bridge's mapped/blocked/quarantined classification. A blocked native projection may still be usable by the adapter; it is not connection status.
- Server names, setting names and fixed planner rejection messages are intentionally visible to the owner. Raw commands, arguments, URLs, headers, environment values, keychain references, source paths, diagnostic payloads and secret-derived configuration hashes are omitted.

Read/preview uses only prepared bridge state; it does not hydrate credentials, read the keychain, invoke a provider or contact a server. The existing clone-returning bridge API stays unchanged. A new deep-readonly accessor permits pure planners to inspect the recursively frozen generation without copying it; hydration atomically replaces the generation and existing readers keep their frozen snapshot.

## Codemode Apply

Adapter Auto leaves scripting inactive; On enables it; Off blocks it even after an explicit activation request. The public `createCodemodeExtension({ models: false })` supplies scripting and the nested tool pipeline. Model execution inside scripts is disabled until its budget boundary is qualified. Scripting does not change MCP server exposure or bypass nested tool hooks.

Apply fences pool admissions and already-captured public prompts, drains lifecycle work, deduplicates and aborts current main/side sessions, rechecks authority and revisions, persists the policy, then updates active tools with `setActiveToolsByName`. New sessions load the same extension and policy. Session identity, history and other active tools are retained. No transport replacement or whole-extension reload occurs.

The asynchronous transition has a 30-second deadline. Failure leaves admissions and tool execution blocked, with captured or late runtimes quarantined. A failure after persistence reports that the policy was saved but activation was not confirmed; it never claims rollback. There is no automatic recovery or fallback. A persisted unsupported native selection refuses adapter startup and needs explicit instance recovery.

Native engine Apply is still not delivered. Adapter shutdown acknowledgement, native closure and native parity must be separately qualified before the engine-switch coordinator can be wired.

## Tests

Focused tests cover real route registration, denied owner modes before body/state reads, readiness, bounded/chunked bodies, stalled/failed readers, cancellation, identity revocation, no sensitive field disclosure, request-guard throttling, immutable bridge generations and planner cases. Apply tests add revision conflicts, interruption acknowledgement, native rejection, lifecycle fencing, late snapshot quarantine and post-persist activation failure. A separate offline Pi 1.0.1 scripted-provider fixture exercises current/new sessions, real scripting, nested tool policy, model execution disabled, Off enforcement and retained history. Only synthetic configuration and isolated state are used.

The [codemode qualification](../reviews/mcp-codemode-settings.md) records the rebuilt browser replay and updated disk-SQLite profiling. The measurements below describe the earlier preview implementation variants.

The initial test exposed a member-auth check reading malformed config before rejecting the role. The role check now precedes config access. Review also caught unregistered GET throttling and ambiguous `status`; tests exercise the actual guard and the response now names native projection explicitly.

## Profiling results

The [machine-readable measurements](receipts/mcp-settings-profile.json) contain three runs per mode per stage, with raw batch timings, instrumentation totals, event-loop statistics, memory readings and source fingerprints. The [initial handler](receipts/mcp-settings-baseline/handler.ts.txt) is retained for reproduction. It was an early unmerged implementation; this endpoint did not exist on mainline, so these are implementation-variant comparisons, not release-to-release speed claims.

Workload: 1,000 direct preview-handler requests in ten batches, 100 configured synthetic servers, 20 KiB of unrelated configuration, real session/user reads against a disposable disk SQLite database, WAL and synchronous=2. Five milliseconds between batches permits event-loop sampling. The pre-dispatch HTTP/auth/CSRF/rate-limit layer is outside the timed workload. CPU profiles include startup/schema creation as well as the timed handler work.

| Stage | Plain median (range), ms | Instrumented median, ms | Instrumented + CPU median, ms |
|---|---:|---:|---:|
| Initial duplicate check + clone | 648.6 (632.1–800.2) | 690.2 | 738.9 |
| Remove duplicate synchronous owner check | 579.6 (562.6–609.9) | 650.8 | 665.2 |
| Also use immutable snapshot view | 278.4 (274.3–444.0) | 335.9 | 394.6 |

The final plain median is 57.1% lower than the initial implementation. Counts per 1,000 requests are stable across measured instrumented runs:

| Operation | Initial | Final |
|---|---:|---:|
| JSON.parse | 10,000 | 8,000 |
| SQLite prepare | 4,000 | 3,000 |
| SQLite query lookup | 4,000 | 3,000 |
| SQLite statement get | 8,000 | 6,000 |
| JSON.stringify | 5,000 | 4,000 |

Removing the immediately repeated owner lookup retains initial, post-body and pre-publication fresh authorisation; it introduces no cross-request authorisation cache. Reusing the already-frozen bridge removes the dominating clone without making shared data mutable. The final response field-name correction and profiling-only unused-assignment cleanup are recorded as distinct measurement stages.

### Remaining hotspots and coverage gaps

- Whole-process CPU samples initially attribute roughly 1.1 seconds across three runs to `structuredClone`; it drops out of the final top frames. This includes setup and is not a precise per-endpoint CPU total.
- Synchronous config reads/parsing, SQL statement preparation and authentication reads remain visible. They need wider call-site/connection-lifetime measurements before cache or query changes.
- Native SQLite `run` frames dominate startup wall samples (roughly ten seconds summed over three fresh processes). Fresh schema creation and auto-vacuum migration are separate suspects; the profile alone does not isolate their causes.
- The batched synthetic workload produces event-loop stalls; it measures scheduling effects, not independent production-request latency. CPU instrumentation adds overhead and sample spread is material.
- Transaction throughput, lock contention, FTS/query plans, large-history parsing and background maintenance are not qualified by this fixture. These remain required profiling work under #1455.

The profiler wraps SQL methods but records no query text or bind values. Raw `.cpuprofile` files remain local under `/workspace/tmp/mcp-settings-api-100/profiles/`; only reviewed synthetic aggregates are committed. Correctness tests run without instrumentation. No production database, provider/network activity, durability setting change or restart was used.

## Candidate validation

On 3 October 2026, frozen tree `751ca6f0c23919aec17da0b07b6220ba8871d33d` passed `make ci-fast`: 5,994 runtime tests, eight existing skips, zero failures; 25 feature tests, nine web checks, and the separate frozen 0.99.1 replay of 468 tests / 8,720 assertions. Final focused routes/guards/config/planner/keychain checks passed 64 tests / 402 assertions. All five typecheck stages passed with the unchanged 95-diagnostic compose baseline; changed-file lint, pack hygiene (24,748 files) and stale-dist checks passed.

Independent narrow reviews found no blocker after correcting revision-hash disclosure, GET rate-limit dispatch and status naming. Broader audit attempts timed out and supplied no findings or approval. The full log is `/workspace/tmp/mcp-settings-api-100/ci-fast.log`, SHA-256 `7bf5dfacf972dff467c3a6dfeb0a04bbcfc33602c7d2fc7b6b522f092511102d`. Only this validation paragraph changed after the frozen gate.

## Reproduce the workload

From the repository root, invoke the existing launcher with disk-backed isolation and an output directory for CPU files:

```sh
bun --no-env-file -e 'import {runLocalTestCommand} from "./runtime/scripts/local-test-priority.ts"; await runLocalTestCommand([process.execPath,"--cpu-prof","--cpu-prof-dir=/tmp/mcp-profile","test/fixtures/mcp-settings-profile.ts","--instrument"],{cwd:process.cwd()+"/runtime",env:{PICLAW_DB_IN_MEMORY:"0"}});'
```

Create the output directory first. Omit `--cpu-prof` for method instrumentation only and omit `--instrument` for an uninstrumented timing run. Each run creates disposable state through the launcher. The measurements and frozen-gate records above describe the earlier read/preview slice, not qualification of the new Apply implementation. Engine activation still needs separate qualification and review.
