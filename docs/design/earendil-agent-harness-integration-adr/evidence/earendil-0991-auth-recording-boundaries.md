# Provider authentication recording boundaries

Synthetic provider authentication stays out of full-mode session recordings and their JSON, JSONL and HTML exports across eight real browser/public-runtime flows. The recorder runs without redaction, so a sensitive sentinel reaching its input would appear in the persisted file and exports.

## Exercised paths

The existing Chromium/WebKit callback matrix covers success, denial/retry, cancellation and expiry. This slice replaces direct fixture storage/broadcast capture with the production `WebMessageProcessingStorageService`, `storeWebMessage`, interaction broadcaster and `WebSessionBroadcastService`. Those services invoke the normal timeline and SSE recording hooks.

The synthetic provider emits device URL/code, progress messages and a manual-code placeholder containing a private sentinel. Submitted handoff, password, text label, access and refresh values use the same sentinel. The browser confirms that private presentation contains it while generic cards do not. All written rows, broadcasts and captured logs remain checked.

Each flow additionally checks:

- full-mode recording status and timeline/SSE event presence;
- a public fixture-note marker retained in raw JSONL and every live-recording export;
- every recorded timeline row ID matches the fixture's saved rows;
- no redaction annotations and no private sentinel in raw persisted JSONL;
- HTTP JSON, JSONL and HTML exports, including `Cache-Control: no-store`, parsed event payloads, exact timeline row IDs and absent redaction annotations;
- a second full-mode recording created through the real start route with a persisted-timeline snapshot;
- exact snapshot row IDs and no private sentinel in the snapshot's persisted file or three exports.

Recording directories and credentials are owned by the isolated test workspace. Database setup explicitly requires an in-memory instance; cases use unique chat IDs and remove their saved rows in `finally`. Cases are serial because they share recording environment configuration and log sinks. Recordings stop before cleanup; environment configuration is restored. No historical records or live credentials are read or modified.

## Evidence scope

The HTTP adapter still bypasses production authentication middleware and uses a synthetic provider. The tested paths cover new-flow session recording storage, timeline snapshots and export handlers. Generic full recording remains an opt-in unredacted feature; this slice changes no production redaction policy. Arbitrary operator-pasted secrets, historical cards/recordings/backups, external OTel exporters, arbitrary tool-output captures, live providers, Delegate parity and native MCP acceptance are unqualified. #1442 and #1458 stay open.

## Validation

The focused matrix passed eight tests / 480 assertions across Chromium and WebKit. Independent review found snapshot-export positive-control and cleanup gaps; both were corrected and re-reviewed with no blockers. Scoped strict typing, Oxlint, silent-swallow, environment and diff checks passed. At baseline `f071d7142fa8be62513ced57428e0401ebe9ee07`, `make ci-fast` passed 5,972 runtime tests, eight existing/opt-in skips and no failures, plus 25 feature tests and nine web checks. The eight browser cases run separately from that gate. Pack hygiene passed 24,742 files; all five typechecks passed with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without shared-cache permission changes. The initial test failed at module load because the fixture named the interaction broadcaster factory incorrectly; correcting the import resolved it. Strict fixture typing includes the repository's existing ambient declarations for `web-push` and `gifenc`.

```sh
PLAYWRIGHT_BROWSERS_PATH=/home/agent/.cache/ms-playwright \
  bun run test:local --cwd runtime \
  --env PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 --env PICLAW_E2E_DISPOSABLE=1 -- \
  bun test --timeout 40000 test/web/provider-auth-ui-matrix.playwright.optional.test.ts
```
