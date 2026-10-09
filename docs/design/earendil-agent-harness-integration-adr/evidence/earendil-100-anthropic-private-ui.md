# Pi 1.0.0 Anthropic private UI and recording qualification

The built-in Anthropic copy-code flow runs through Piclaw's private authentication dialog, real card-action service, public `ModelRuntime`, credential store and recording/export paths. Ten isolated browser cases cover five outcomes in Chromium and WebKit. No production code is changed.

## Scope and executable path

The target is exact Pi 1.0.0 at upstream gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`. The installed Anthropic implementation is pinned to SHA-256 `80fc4412ce09d42d678f5094932f3e58eecec53df40c4530fc4f55651a57d0a4`. Piclaw source starts at `1fc14931883425456b7d352759cd6c0004375c18`, after the separately approved narrow-preview fix.

The test does not register or replace the provider. It chooses the built-in `anthropic` OAuth method, then `copy_code`, through the real adaptive-card renderer and private presentation UI. The token endpoint alone is replaced by an exact request/payload-checking synthetic fetch. Tests assert PKCE verifier/challenge, state, client ID, code and the fixed copy-code redirect.

Cases in each browser:

- Success, including closing/reopening the transient dialog without cancelling the flow. Credentials persist only in the disposable auth file. Model selection stays unchanged until the user explicitly activates a model.
- Denied exchange followed by a fresh successful retry; the first error includes a synthetic sensitive diagnostic that must not appear publicly.
- Mismatched state, rejected before any token exchange.
- Cancellation at the manual prompt, without an exchange.
- Cancellation of a blocked exchange through the actual Cancel button; the transport signal aborts and no credential is stored.

The exchange sends a progress notification before awaiting fetch. The private callback may therefore return a progress presentation with `Check & Continue`; the test advances through that UI instead of assuming immediate model activation. The Cancel button in that returned view reaches the backend and aborts the blocked request. This does not qualify arbitrary cancellation timing or browser-request abort propagation.

## Secrecy and ownership observations

The fixture uses a 390×844 viewport, a disposable loopback server and in-memory message database. Private responses must carry `Cache-Control: private, no-store`, `Vary: Cookie` and `Referrer-Policy: no-referrer`. Authorization URL, state, verifier, code, access/refresh token and sensitive provider-error sentinels are checked against every row in the fixture chat, broadcasts and captured structured logs, including cancellation cleanup.

Full session recordings and JSON, JSONL and embedded-HTML exports must contain public control events and the expected assistant rows while containing none of those private values. The same checks apply to a later persisted-timeline snapshot. Events must have no redaction fallback marker; this tests exclusion from recording, not successful removal after disclosure.

The live family-authentication gateway, owner/browser account binding and full deployed timeline shell are not exercised by this test server. The callback handler, storage, renderer and export functions are real, but a test session supplies model activation and a test server dispatches routes. Existing synthetic-provider and family-authorization tests remain unchanged. No credential-bearing historic backups or external telemetry collector is inspected.

## Isolation and limits

`scripts/check-anthropic-private-ui-100.ts` requires explicit `PICLAW_RUN_ANTHROPIC_PRIVATE_UI_TESTS=1`, `PICLAW_E2E_DISPOSABLE=1` and an installed browser path. It starts the full test process in a new loopback-only network namespace, drops UID/GID privileges and all capability/supplementary-group sets, and applies `no-new-privs`. The child receives a minimal environment and a nonexistent home before the normal filesystem-isolation launcher creates owned temporary paths.

An explicit preload verifies isolation and denies fetch/preconnect before SDK/test imports. Each case replaces that denial only with its exact mocked token endpoint; the browser may contact only the disposable fixture origin. The namespace independently prevents external egress. No callback listener on port 53692 was present at sampled prompt/exchange/settlement points. This is not a continuous socket audit or mount/filesystem sandbox. No live account, inference prompt, MCP server, deployment or restart is used.

Browser and server resources, auth flows, recordings and environment overrides are cleaned up in nested `finally` blocks. Log observation continues through cancellation with a bounded 100 ms window. Longer late activity is unqualified.

## Evidence and validation

The measured bounded case summary is `receipts/earendil-100-anthropic-private-ui.json`. Mandatory tests verify its exact case set, current SDK fingerprint, scope limits and ordinary-namespace preload refusal. The optional suite executes all ten browser paths; ordinary CI does not replace that execution with receipt assertions.

Initial runs found fixture assumptions: success needed the public progress check, and expected transport abort was incorrectly counted as an unexpected request. Both were corrected without a production workaround. An early review inferred an unavailable Cancel path; actual button execution disproved it for this progress-returning exchange. A later review required explicit verifier scans and teardown log observation, now implemented. Failed logs remain separate from passing qualification.

First complete matrix: ten passes / 1,138 assertions. Strengthened row/header matrix: ten passes / 1,254 assertions. Mandatory receipt/refusal: two passes / 122 assertions. The final review-corrected matrix passed ten tests / 1,342 assertions. Independent delta review found no blocker. The frozen full `make ci-fast` gate passed 5,916 current-runtime tests, eight existing skips and zero failures (38,101 assertions, 854 files, 904.28 seconds), plus 25 feature tests, both frontend builds and nine web checks. Separate frozen 0.99.1 replay passed 468 tests / 8,720 assertions. Final pack hygiene checked 24,746 files; strict typing, all five repository typechecks and scoped lint passed, retaining the existing 95 compose diagnostics. Final browser repeat: ten passes / 1,342 assertions; mandatory receipt/refusal repeat: two passes / 122 assertions.

Frozen tree: `a8e3fd6b059d9d1f70345621323836fc41b0f797`. Full log: `/workspace/tmp/1495-private-ui-100/ci-fast.log`, exit zero, SHA-256 `5347e3dfc3c0fd4bdd74b9e19b3dd972d67184362f31f190cf591b5caa2f5eed`. Only this evidence text changed after the full gate.

Full provider/token/URI validation, family gateway acceptance, deployment and native-MCP qualification remain separate #1495/#1458 gates.
