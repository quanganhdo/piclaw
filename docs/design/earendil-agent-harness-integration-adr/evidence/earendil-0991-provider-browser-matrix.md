# Anthropic and OpenRouter browser/manual OAuth methods

Twenty synthetic public provider-method cases pass separately under Bun 1.4.2 and Node 26.7.0 for exact Earendil 0.99.1. Each execution uses a fresh loopback-only OS network namespace, guarded token exchanges and real owned IPv4 callback HTTP requests. Credentials stay in memory and no inference runs.

## Matrix

Both providers exercise manual success, callback success, invalid callback followed by success, callback denial, token denial, malformed JSON, prompt cancellation, exchange cancellation and pre-abort. Anthropic additionally rejects manual state mismatch; OpenRouter rejects a response without its permanent key.

Success checks exact token/key fields, PKCE verifier/challenge, declared request payloads, callback status/no-store header, manual prompt cancellation and callback-port release. Anthropic refresh rotates access/refresh values using the expected request; OpenRouter refresh returns the same non-expiring key credential. Negative cases check rejection class and exact request counts. Pre-abort records the actual difference: Anthropic still emits one auth URL after its aborted callback bind, while OpenRouter emits none. Neither prompts or exchanges; any observed redirect port must be released.

## Isolation and provenance

Public `@earendil-works/pi-ai/providers/anthropic` and `providers/openrouter` factories provide OAuth methods. No private implementation module is imported. Read-only source inspection determines request assertions; installed OAuth, shared callback and PKCE modules are hash-pinned in both executable fixtures and ordinary receipt tests.

Before provider imports, execution verifies a distinct network namespace, only loopback, no IPv4 route, non-root UID, zero capability sets, `no_new_privs`, no kernel supplementary groups and explicit `PI_OAUTH_CALLBACK_HOST=127.0.0.1`. A pre-import fetch/preconnect guard rejects unexpected traffic. Per-flow synthetic fetch validates exact provider endpoint/payload. Real HTTP requests accept only the emitted owned loopback port. Active `/proc/net/tcp` listeners must bind exactly IPv4 loopback; closed ports must be rebindable. Namespace isolation prevents the fixed Anthropic port from reaching a host listener.

Real per-case deadlines, GNU process-group timeout and parent watchdog bound execution. All callbacks use `Connection: close`, callback tasks are observed, abort signals are checked, and global fetch is restored. No browser launcher is called. This is external-egress isolation, not a filesystem or malicious-code sandbox.

## Reproduction and receipts

The opt-in Bun suite requires Linux namespaces, `sudo -n`, `ip`, `setpriv` and GNU `timeout`; missing prerequisites fail without fallback:

```sh
bun run test:local --cwd runtime \
  --env PICLAW_RUN_AUTH_BROWSER_MATRIX=1 --env PICLAW_E2E_DISPOSABLE=1 -- \
  bun test test/agent-control/provider-browser-matrix-0991.optional.test.ts \
  test/agent-control/provider-browser-matrix-receipt.test.ts
```

Fresh Bun and real Node executions are serial and separately archived in `receipts/earendil-0991-provider-browser-{bun,node}.json`. Ordinary CI validates frozen receipts, reviewed hashes and refusal of ordinary-namespace execution. It does not freshly run Node or claim executable callback qualification from receipt checks alone.

## Initial failures and limits

Earlier preflight receipts used fetch interception without OS isolation and are excluded from final namespace qualification. Review gaps in import guarding, deadlines, pre-abort checks, fixed-port ownership, bind verification and independent hash assertions were corrected. The first Node namespace run failed because Node `getgroups()` includes the effective GID while Bun omits it; the kernel `/proc/self/status` Groups field verifies cleared supplementary groups for both.

This receipt covers two public method owners, their browser/manual callbacks and bounded refresh behaviour. Full packaged CLI/Piclaw UI, actual browsers at provider websites, remaining Radius/xAI/Meta flows, malformed Anthropic token-field semantics, exhaustive callback races, live tokens, storage lifecycle, external traces, Delegate parity and native MCP acceptance are unqualified. #1442 and #1458 stay open. No live credentials, inference, deployment or restart.

Fresh serial namespace runs passed 20 cases each under Bun 1.4.2 and real Node 26.7.0. The focused opt-in executable/receipt/refusal suite passed three tests / 214 assertions. Scoped strict typing, Oxlint and diff checks passed; independent review findings were fixed and re-reviewed with no blockers.

At baseline `904ff166ba6ae0a5c09ed84252b1ca9831b027a3`, `make ci-fast` passed 5,990 runtime tests, eight existing/opt-in skips and no failures, plus 25 feature tests and nine web checks. The executable namespace matrix ran separately from the canonical gate. Pack hygiene passed 24,743 files; all five typechecks passed with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without shared-cache permission changes.
