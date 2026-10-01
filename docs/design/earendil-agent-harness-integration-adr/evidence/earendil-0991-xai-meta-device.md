# xAI and Meta device-method qualification on Bun

Thirty-three synthetic public OAuth method cases execute on Bun 1.4.2 against exact Earendil 0.99.1. Each execution requires a separate loopback-only OS network namespace; provider HTTP is intercepted and validated. No inference, live account, browser launch or credential persistence runs.

## Public methods and cases

The fixture imports only public `providers/xai` and `providers/meta` factories after installing the network guard. Seven reviewed hashes pin the provider entries, lazy-auth helper/loader, both OAuth implementations and shared device poller. No private SDK implementation is imported.

Both owners cover pending-to-success, server-directed slowdown, denial, malformed device/token responses, unsafe verification URI, independently mixed safe/unsafe basic and complete URI fields, deadline expiry, initial-wait cancellation, blocked start/poll cancellation and pre-abort.

xAI additionally exercises refresh-token preservation when rotation is omitted, refresh denial and default token lifetime. Meta additionally exercises missing minted key/setup URL, expired identity during login/refresh and blocked key-mint cancellation. Successful login checks exact credentials, expiry and `toAuth`; refresh checks rotation/re-minting without submitting inference.

The request guard checks exact endpoints, form keys, client IDs, scopes/referrer, headers and mint body. Device events and Meta progress copy/count are checked. Real Bun timers verify first-poll cadence, pending/slowdown gaps and expiry; no fake clocks are used. A 100 ms observation after settlement checks for late guarded requests/events before teardown aborts. This bounded observation does not certify exhaustive timer/listener teardown.

## Observed provider differences

- Both providers invoke fetch with an already-aborted signal in the pre-abort case. The mock verifies that signal and rejects it; no device event, poll or mint follows. This establishes rejected pre-aborted operation, not zero fetch invocation.
- xAI rejects either unsafe basic or complete verification URI. Meta selects a safe complete URI or falls back to the safe basic URI. Mixed-field Meta cases succeed and emit only the selected safe URI.
- URI checks establish scheme handling only. Provider host allowlists, credential/port restrictions and URI-origin consistency are outside this receipt.
- xAI credentials subtract five minutes from token expiry; missing token lifetime defaults to one hour. Meta stores the identity token as refresh material and mints a one-day API key; expired identity requires fresh login.

## Isolation and execution

Before SDK imports, the fixture checks distinct namespace identity, only loopback, no IPv4 routes, expected non-root UID, zero capabilities, `no_new_privs` and cleared kernel supplementary groups. Minimal child environment contains synthetic fixture configuration only. GNU timeout, parent watchdog and real per-case deadlines bound execution. Namespace isolation denies external egress independently of guarded fetch/preconnect; direct socket attempts are not audited. Filesystem access is not sandboxed.

```sh
bun run test:local --cwd runtime \
  --env PICLAW_RUN_XAI_META_AUTH_TESTS=1 --env PICLAW_E2E_DISPOSABLE=1 -- \
  bun test test/agent-control/xai-meta-device-0991.optional.test.ts \
  test/agent-control/xai-meta-device-receipt.test.ts
```

The executable matrix is opt-in and fails if Linux namespace prerequisites are unavailable. Ordinary CI checks the frozen Bun receipt, hard-coded reviewed hashes, exact case list and refusal outside a namespace. Piclaw runtime qualification is Bun-only; no Node run or comparison was performed.

## Scope and validation

This receipt covers xAI/Meta public device and refresh methods with synthetic responses. Packaged CLI, full Piclaw routes, live token validity, persistence/concurrency, exhaustive request timeouts/default polling modes, origin policy, Radius, external traces, Delegate parity and native MCP acceptance are unqualified. #1442/#1458 remain open; no deployment/restart.

Review strengthened separate URI fields, provider/helper provenance, exact progress events, timing upper bounds and post-settlement observation. Earlier 29-case probes are preliminary; the final matrix has 33 cases. The final executable/receipt/refusal set passed three tests / 233 assertions on Bun 1.4.2, covering all 33 cases. Scoped strict typing, Oxlint and diff checks passed. Independent review findings were fixed and re-reviewed with no blockers.

At baseline `34da60f848a69779042ef4606047a83f1d336839`, `make ci-fast` passed 5,992 runtime tests, eight existing/opt-in skips and no failures, plus 25 feature tests and nine web checks. The executable namespace matrix ran separately. Pack hygiene passed 24,743 files; all five typechecks passed with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without shared-cache permission changes.

The first hosted run `36827024187` failed one unchanged family-TOTP replay test: 5,991 passed / eight skipped / one failed. The assertion generated a fresh code across the 30-second boundary at 06:56:30 rather than replaying the consumed proof. Separate prerequisite PR #1488 (`f20d41b3dd5c814f53ee95d5353a880f1b1979f0`) fixes that test with its existing injected clock and one captured proof; production authentication is unchanged. Its exact-head CI and post-merge 15-test / 95-assertion check passed.

After merging that prerequisite, the candidate at `0618acda50640b817182f1802e69c17131ccb694` passed a fresh canonical gate with the same 5,992/eight/zero plus 25 feature and nine web checks, pack hygiene 24,743 and all five typechecks. Combined device/TOTP focused checks passed 18 tests / 328 assertions. The initial failure is retained separately from the corrected run.
