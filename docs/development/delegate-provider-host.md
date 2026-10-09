# Delegate provider host foundations

The injected host modules exercise a parent-executed Delegate request lifecycle against the merged budget ledger. They make no provider requests and install no runtime API. Production integration needs an authoritative provider/authentication settlement contract that Pi 1.0.1 does not expose through its public streams.

## Implemented

- `child-request-scope.ts`: one active request, one iterator, bounded one-slot delivery, captured authority/signal/deadline/model, unique wire IDs, exactly-once dispatch and sticky unresolved settlement failures. Cancellation stops public output; raw execution and late usage reconciliation remain tracked. Close publishes its shared promise before abort listeners can reenter.
- `child-request-accounting.ts`: captured database and work binding, asynchronous reserve/dispatch and exactly-once usage settlement. Unknown zero telemetry retains a hold and rejects `settled`/`close`. Documented-free catalogue metadata cannot turn an errored zero-usage request into no-charge success.
- `child-request-http.ts`: one exact host-selected endpoint, admission immediately before actual fetch, fresh authority after the ledger marker, no redirects or retries, bounded response bytes and tracked fetch/read/cancel tails. Unread bodies are cancelled before raw tail completion. Bun preconnect is denied.
- `child-request-executor.ts`: injected provider starter, retries disabled, bounded provider event/response bytes, exact disclosed-model checks and separately supplied raw task settlement. Public terminal/result promises are insufficient inputs for that task.
- `child-request-captured-provider.ts`: the actual public composed Provider receives captured complete request-scoped options and public normalised transcript. It performs no second authentication lookup or provider substitution. This helper requires a separately qualified raw task handle.
- `child-request-validation.ts` and `child-request-output.ts`: bounded JSON context/options and public event projection. Initial text-only request policy rejects tools, images and unknown authority fields. Successful, partial and error events exclude arbitrary provider diagnostics.
- `child-request-host.ts`: a tested startup-owner API factory with explicit unavailable behaviour when no trusted host is installed. This branch does not expose it through `__piclaw_runtime` or register a provider.
- `request-cost-bound.ts`: exact upward-rounded integer-micro ceiling using trusted model token limits and the highest rate for each overlapping input/cache/output category across catalogue tiers. Missing pricing, invalid limits or unsafe totals return unknown. Zero catalogue rates need an independent free classification.

## Pi 1.0.1 execution limits

Public `ModelRuntime.streamSimple` prepares authentication asynchronously and returns an eager assistant-event queue. Its public `result()` resolves on terminal delivery. Composed Provider streams expose no promise for their executing task. Treating terminal/result completion as raw cleanup acknowledgement would permit scope replacement while provider work or authentication refresh still runs.

Public `getAuth` accepts a signal, but `resolveProviderAuth` races cancellation and bounded refresh waits against underlying operations. Rejection ends the caller's wait; it does not prove the raw refresh/store operation completed. A facade timeout cannot grant a replacement credential lease or establish atomic logout-to-send behaviour.

A production host needs a public raw authentication task/settlement lease and raw provider task acknowledgement, or a specifically reviewed HTTP provider implementation whose tails can be established without private SDK access. The current injected code requires those handles and fails closed without them. Matching an API enum does not qualify custom providers, virtual routing, ambient credentials, WebSocket transport or unlisted tariffs.

## Budget and provider coverage

The output/token price ceiling is safe only when the executor enforces the captured limits and the provider's billed categories/tariffs are covered. Images, unbounded cache multipliers and ambient/repricing compositions have no accepted execution plan here. Initial MCP plan is `none`; requiring MCP must reject before work begins.

Competing parent and side requests still need the same reservation/send boundary before shared budget enforcement can be accepted. The existing pre-prompt budget check alone cannot reserve capacity for multiple concurrent paid calls. No parent issue is closed by these foundations.

## Tests and operational boundary

Synthetic tests cover post-dispatch revocation, cancellation during raw preparation, late results, terminal-before-tail completion, wrong disclosed model, settlement faults, duplicate IDs, stalled consumers, reentrant close, HTTP send/body cleanup, output diagnostics, validation and the real disposable ledger. Five type checks and changed-file lint accompany focused tests. A frozen full gate and independent review are required before publication.

## Synthetic host profile

`runtime/test/fixtures/child-request-host-profile.ts` exercises 1,000 injected scopes and exactly 2,000 delivered events with 1,000 completed settlements per run. Three plain runs took 31.2–43.5 ms (median31.6); three JSON-instrumented runs took30.1–37.1 ms (median32.9). Instrumentation counted2,000 JSONserialisations/735,000bytes and about1.22ms in the third run; no JSONparse calls were observed. There is no database, authentication or HTTP workload in this profile. The separate merged ledger profile retains WAL/FULL measurements.

Event-loop sampling used1ms resolution with9samples/run; the third instrumented maximum was3.92ms. The CPUartifact contains39samples/43.5ms and includes startup. These small synthetic measurements locate lifecycle/clone/serialization costs only; they establish no production latency, provider resource cost or before/after improvement. Local machine report: `/workspace/tmp/pi-101-epic-audit/delegate-host-profile/report.json`.

No production database, credentials, live provider, installation or restart is used. Source merge approval does not authorise deployment or real-account canary tests. Pi-durable work remains outside this task.
