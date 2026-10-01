# Radius authentication methods on Bun

Seventeen synthetic Radius public OAuth cases exercise browser callbacks, device polling and refresh on Bun 1.4.2 against exact Earendil 0.99.1. Execution requires a fresh loopback-only OS network namespace. No inference, live account, browser launch or credential persistence runs.

## Exercised behaviour

The fixture imports the public `providers/radius` factory with a synthetic gateway, ID and name. Eight reviewed hashes pin the provider/configuration, OAuth/lazy loader/helper, shared callback, PKCE and polling modules. No private SDK implementation is imported.

Browser cases check discovered authorisation endpoint, exact authorisation parameters, PKCE verifier/challenge, state rejection followed by success, callback denial, denied token exchange, malformed discovery and cancellation. Callback requests use real owned loopback HTTP with `Connection: close`; statuses and no-store headers are checked. Active listeners must bind exactly IPv4 loopback on port 1456, with no IPv6 listener at that port; after settlement the IPv4 port must be rebindable and no IPv6 listener may remain.

Device cases check pending-to-success, slowdown, denial, missing required fields, deadline expiry, blocked polling cancellation and cancellation during a pending wait. Radius polls immediately; pending waits one second, and slowdown without an interval increases the next wait to six seconds. Real Bun timers verify bounded polling gaps and expiry without fake clocks.

Successful credentials require exact access/refresh/scope fields, one-minute expiry skew and public `toAuth` behaviour. Refresh checks exact payload and rotation; refresh denial and unknown selection are separate cases. Exact request, prompt and notification counts are checked. A 100 ms post-settlement observation detects late guarded requests/events before final teardown abort; exhaustive timer/listener lifecycle is outside scope.

## Pre-abort and limits

Radius invokes its selection prompt before checking an already-aborted signal. The fixture's prompt observes cancellation and rejects; there are no HTTP requests or notifications. This qualifies prompt-rejected pre-abort behaviour, not zero prompt invocation.

The exact provider lacks comprehensive token-field and discovery/device-URI validation. This slice tests missing discovery/device fields, but does not certify malformed token fields, discovered endpoint policy, device URI schemes/origins or live gateway correctness. Those are acceptance gaps, not implied waivers.

## Isolation and reproduction

Before SDK imports, the fixture verifies distinct namespace identity, only loopback, no IPv4 routes, expected non-root UID, zero capabilities, no new privileges and cleared supplementary groups. Fetch/preconnect guards precede dynamic public imports and validate exact synthetic endpoint/payloads. Real HTTP accepts only the owned callback origin/path. Namespace isolation prevents the fixed callback port from reaching a host listener. Direct socket attempts are not audited; filesystem access is not sandboxed.

Real case deadlines, GNU process-group timeout and parent watchdog bound execution. Missing Linux/sudo/ip/setpriv/timeout prerequisites fail the explicitly enabled suite; no unsandboxed fallback exists.

```sh
bun run test:local --cwd runtime \
  --env PICLAW_RUN_RADIUS_AUTH_TESTS=1 --env PICLAW_E2E_DISPOSABLE=1 -- \
  bun test test/agent-control/radius-auth-0991.optional.test.ts \
  test/agent-control/radius-auth-receipt.test.ts
```

Ordinary CI validates the frozen Bun receipt, reviewed hashes, exact case list and refusal outside a namespace. Executable qualification runs separately under Bun only. Full packaged CLI/Piclaw routes, catalog refresh, storage/concurrency, external traces, Delegate parity, live canary and native MCP acceptance are unqualified. #1442/#1458 stay open. No deployment or restart.

Review added IPv6 listener checks, callback-boundary listener checks, distinct deadline failures, case-driven cancellation proofs and per-mode receipt assertions, and clarified the observed pre-abort prompt invocation. These are point-in-time listener checks, not continuous socket auditing. The final focused executable/receipt/refusal suite passed three tests / 279 assertions; scoped strict typing, Oxlint, environment and diff checks passed. Independent review findings were fixed and re-reviewed with no blockers. At baseline `767250d335e7b96adbbbb005bfdac99d1479d861`, `make ci-fast` passed 5,994 runtime tests, eight existing/opt-in skips and no failures, plus 25 feature tests and nine web checks. The executable namespace matrix ran separately. Pack hygiene passed 24,743 files; all five typechecks passed with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without shared-cache permission changes.
