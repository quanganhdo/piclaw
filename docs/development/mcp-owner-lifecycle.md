# MCP bridge leases across extension reloads

Piclaw acquires one prepared MCP bridge lease for each extension-load generation. Reload releases the previous generation after its shutdown handlers settle, then acquires the latest prepared configuration and credential references. Adapter/Auto defaults and the read-only settings UI are unchanged. This slice contributes to #1451; it does not enable engine Apply.

## Ownership and failure handling

[`createMcpBridgeOwner`](../../runtime/src/agent-pool/mcp-bridge-owner.ts) supplies the named `piclaw-mcp-owner` inline extension. It has no acquisition or write side effects until the SDK invokes its factory. Piclaw still sets `initializeOnLoad: false`; binding the session starts eager adapter servers.

The owner verifies both its local generation and the SDK's published extension result. Pi 1.0.0 can complete a factory, fail its deferred registration commit, discard the extension and resolve resource loading with a diagnostic. A completed factory alone therefore cannot establish ownership. Missing, duplicate or failed MCP owner publication rejects and releases the lease. Unrelated extension warnings retain their existing behaviour.

The session wrapper rejects overlapping and reentrant reloads before invoking the SDK. It checks ownership before and after the caller's `beforeSessionStart` barrier, and after reload returns, including unbound sessions. Direct disposal and failed session construction retain an idempotent release fallback. Operation sessions still omit MCP.

Pi 1.0.0 runs shutdown handlers in registration order but reports their exceptions and can continue. The adapter also catches cleanup errors. Lease release is not confirmation that every transport stopped. Active-turn execution fencing, failed-shutdown quarantine, engine selection, settings writes and server/auth/exposure management require further work before Apply can be enabled. Extensions run as trusted code; this wrapper is not an extension sandbox.

## Tests

The [isolated child driver](../../runtime/test/agent-pool/mcp-bridge-reload.test.ts) runs the exact 1.0.0 public SDK and adapter 2.31.0 against a disabled synthetic server. It checks:

- fresh configuration and synthetic credential generations on repeated reloads;
- old-lease release, revoked environment resolution and no double release;
- session ID/history preservation and unrelated extension reloads;
- initial/follow-up factory failures and an injected post-factory SDK registration failure;
- bound and unbound reload checks, simultaneous/reentrant calls and disposal during the barrier;
- propagated barrier rejection, reported shutdown errors and runtime/direct disposal;
- no configuration or credential-file writes during normal initial resource loading.

The commit-failure case uses the public project-trust callback to inject a throwing registration action before a built-in fixture factory loads. The SDK discards that extension after its factory completes; the owner rejects the unpublished result. Unit cases separately check the production inline path and its diagnostic/duplicate cases.

The [host integration test](../../runtime/test/agent-pool/mcp-adapter-bundled.test.ts) also exercises `createSessionInDir` with a real synthetic Bun stdio process. It checks no process before binding, one owner per session, old-process exit before replacement startup on reload, unchanged history, new-session replacement and final process exit. Its existing proxy-call checks use adapter internals; the new reload and history checks use public session methods. The synthetic stdio child is not a live MCP service.

Focused host/lease suite: **23 tests, 110 assertions, zero failures**. Final related MCP/session/credential suite: **116 tests, 526 assertions, zero failures**. Types pass for the runtime, scripts, settings, panes and compose contract; compose retains 95 unchanged transitive diagnostics. The new fixture/tests also pass explicit strict compilation. Scoped lint has zero warnings/errors and pack hygiene checks 24,682 files.

The frozen candidate passed `make ci-fast`: **6,029 passed, 8 skipped, zero failed**, then 25 feature and 9 web build tests. The separate historical 0.99.1 gate passed 468 tests / 8,720 assertions; those results remain historical. Runtime stage elapsed: 907.13 seconds. Tested tree: `d0b99a2e0bec18c0bd354ae89817f7180cc893ea`. Full-gate log SHA-256: `a2937ea1d4262c1123c9aaa4c846a82566e4ffd6540ecbbdfd4a1bd7a5cba4fd`. Only this validation prose changed after the gate. A second independent corrected-candidate review found no blockers within the stated scope.

### Recorded corrections

- The first delegated review timed out; it supplied no approval. A subsequent review found missing SDK publication validation and overlapping-reload protection; both were added with regressions.
- An initial expanded fixture imported `loadExtensions`, which the SDK does not publicly export. Those ten child cases failed before execution. The fixture now uses only exported SDK APIs.
- The first host reload case used `bindExtensions({})`. Pi 1.0.0 emits initial startup for that call but skips reload startup without UI/command/shutdown/error bindings. Adding the error listener used by Piclaw's real web binder made the existing-deadline test pass. No timeout was increased.
- The first full gate stopped before tests because the generated environment-document index lacked this page. Regeneration added one documentation reference; no runtime environment reader changed.

## Child-process profiling

The [machine-readable receipt](receipts/mcp-owner-lifecycle-profile.json) contains nine candidate runs: three plain, three with JSON/clone counters, and three with Bun CPU profiling of the actual fixture child. Each run prepares and reloads 200 generations: **1,800 reloads and 1,809 released leases** in total. All runs preserve history and report zero fetch/preconnect attempts. The fixture denies fetch; it does not use an OS network namespace.

Plain runs spent 97.7–125.7 ms inside 200 reload calls; the median total was 105.3 ms. Per-run median reloads were 0.38–0.59 ms. CPU totals include configuration rewrites/preparation and other workload work, so they are not directly comparable with reload-only elapsed time. Startup/module loading is included in the sampled CPU profiles. Instrumented timings are reported separately; overlapping spreads do not establish zero instrumentation overhead.

Each instrumented run counted 1,400 JSON parses (161,270 string code units), 400 serialisations (199,988 code units) and 2,000 structured clones. Cumulative clone time was 8.9–11.5 ms, parse time 1.8–2.6 ms and serialisation time 1.3–1.4 ms. Event-loop sampling uses 1 ms resolution and records sample counts; the largest observed delay across runs was 14.3 ms.

Across 1,409 CPU samples, unnamed native frames account for 47.8%. The largest identified self-sample groups were `existsSync` (2.48%), `structuredClone` (1.70%), `writeFileSync` (1.56%) and `readFileSync` (1.28%). File discovery, repeated configuration parsing and cloning warrant larger representative workloads before choosing an optimisation. No performance change or baseline speedup is claimed for this ownership fix.

Database queries/locking, large histories, active model/tool turns, real transport child CPU, dedicated heap/GC behaviour and systemwide workload latency are unmeasured here. The broader database/CPU audit and combined #1455 qualification are still open.

## Reproduce

From the repository root:

```sh
bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test \
  test/agent-pool/mcp-bridge-owner.test.ts \
  test/agent-pool/mcp-bridge-reload.test.ts \
  test/agent-pool/mcp-adapter-bundled.test.ts

bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 --env PI_OFFLINE=1 \
  --env OTEL_SDK_DISABLED=true -- bun --no-env-file \
  test/agent-pool/fixtures/mcp-bridge-reload.ts success 200 instrument
```

Use `plain` instead of `instrument` for uninstrumented runs. Add Bun's `--cpu-prof --cpu-prof-dir=<private-output-directory>` before the fixture path for separate child CPU profiles. Keep raw profiles local: they can contain filesystem paths. No installation, deployment, live credentials or service restart is required.
