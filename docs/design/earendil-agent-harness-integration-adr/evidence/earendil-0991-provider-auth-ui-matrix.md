# Synthetic provider auth through the real web card callback (#1458)

Chromium and WebKit exercise the fixture's provider picker, explicit OAuth method selection, private multi-step dialog, completion and explicit model activation through Piclaw's real DB-backed card callback and public ModelRuntime. This is fresh-source fixture evidence toward AUTH-02/03/05/07, not full packed CLI/UI, production request authentication or live-provider acceptance.

## Runtime and browser boundary

The fixture creates a disposable profile and the real Piclaw FileCredentialStore, public ModelRuntime and ModelRegistry. It registers a typed synthetic provider with API-key and OAuth methods; streaming methods throw if called. The TestAgentControlSession supplies session bookkeeping only. Credential writes, model composition and availability are handled by the real public runtime.

A test-only loopback server serves the browser fixture and delegates POST `/agent/card-action` to WebAdaptiveCardSidePromptService. The service calls the real login handler under the initiating chat context and persists/broadcasts its normal generic card updates. The server bypasses production HTTP authentication/Origin middleware; those boundaries are not certified by this test. Browsers deny requests outside the test origin, and no external login URL is opened.

Each engine runs four cases:

| Case | Executed assertions |
|---|---|
| Success | Picker → explicit OAuth choice → private select/device/manual/secret/text prompts → stored OAuth → model unchanged until explicit activation |
| Denial/retry | Synthetic provider denial returns generic dialog failure and stores no credential; a newly initiated flow completes and activates explicitly |
| Cancel | Actual callback cancels; private dialog closes, public provider signal aborts, credentials remain absent and stale reveal returns 409 |
| Expiry | Short device-code deadline closes the dialog, aborts the backend provider signal, stores no credential and rejects stale reveal |

The success case closes and reopens the private dialog without aborting the pending provider flow; current action bindings continue correctly. Verbose progress events do not remove the actionable device code. Provider-emitted URLs/codes/messages and submitted handoff/password/text values share a synthetic sentinel prefix. All written message rows, broadcasts and captured structured logs are checked for that prefix; only the live private dialog and disposable credential store contain it. Method selection never relies on its default.

Setup and assertion failures clean the session flow, log sink, browser, server and owned workspace. Tests run with an empty inherited account environment through the isolated launcher; browser binaries are loaded from an existing cache without mutating it.

## Validation

Eight scenarios passed 80 assertions across Chromium and WebKit. All five standard typechecks, strict server-fixture typechecking with existing dependency declarations, scoped lint and diff checks passed. Browser fixture JavaScript is built by Bun from the current renderer/dialog source. Reviews corrected method selection, intermediate-row tracking, early cleanup and backend termination proof; final scoped review found no blocker.

At merged device-matrix baseline `b50df27717c69a61ccd93b489217a77c5c4c18f9`, `make ci-fast` passed 5,970 runtime tests, eight existing/opt-in skips and no failures, plus 25 feature tests and nine web checks. Optional browser files are excluded from that gate; the eight browser cases were executed separately. Pack hygiene passed 24,742 files; final five typechecks and diff checks passed with the unchanged 95-diagnostic compose baseline. The environment snapshot adds only documentation references to existing opt-in flags. Private Bun caches were used without shared-cache permission changes.

```sh
PLAYWRIGHT_BROWSERS_PATH=/path/to/browser-cache \
  bun run test:local --cwd runtime \
  --env PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 --env PICLAW_E2E_DISPOSABLE=1 \
  -- bun test --timeout 35000 test/web/provider-auth-ui-matrix.playwright.optional.test.ts
```

The test is explicitly opt-in and ordinary CI excludes optional browser files. An ordinary skipped run is not a new browser receipt. Use a disposable target/profile and no inherited real account variables.

## Remaining qualification

The provider is synthetic and the HTTP server is a test adapter. This does not execute packaged provider-owned device polling, the standalone CLI `/login`, a packed web artifact or production authentication middleware. It does not certify all providers, historical cards/secrets/backups, complete tracing, Delegate approval/auth parity, endpoint reachability or approved live login/refresh/logout. Native MCP public-seam blockers and separate deployment/restart/inference approvals are unchanged. #1458 and #1442 remain open.
