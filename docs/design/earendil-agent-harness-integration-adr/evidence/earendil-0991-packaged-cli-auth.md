# Earendil 0.99.1 packaged interactive CLI authentication

The official packaged Earendil CLI completes synthetic OpenAI and Codex OAuth login, rejects denied exchanges and mismatched state, and cancels before exchange. Eight PTY cases run under Bun 1.4.2 in separate loopback-only network namespaces.

## Artifact and invocation

The admitted registry receipt pins the coding-agent archive SHA-512. All 70 bundled JavaScript files in the installed package were compared byte-for-byte with that verified archive. The receipt pins an aggregate bundle SHA-256, both public OAuth module hashes and the repository lockfile hash; ordinary CI checks these fingerprints. Package version checks alone are insufficient.

The child invokes the public `pi` entry `dist/bundle/cli.js`, interactive `/login openai` or `/login openai-codex`, and `/quit`. It imports no private runtime API. Flags disable session persistence, extensions, skills, prompt templates, themes, context files and tools. Profiles, home, working directory and browser launcher are test-owned temporary directories. No inference prompt is submitted.

## Isolation and terminal checks

- `sudo -n unshare --net` creates a separate network namespace; only loopback is enabled. Before CLI startup, the driver checks namespace identity, `/proc/net/dev` and the absence of IPv4 routes.
- `setpriv` returns to the invoking non-root UID/GID, clears supplementary groups and all capability sets, and sets `no_new_privs`. The UID retains normal filesystem access; this is not a mount/filesystem sandbox or protection against malicious package code.
- A minimal child environment contains disposable profile paths and synthetic fixture configuration. No keychain values or parent credential variables are forwarded.
- A test-owned `xdg-open` records the argument count and URL hash. Exactly one argument must match the displayed authorisation URL. URLs and tokens are never written to the launcher receipt.
- A preload occupies callback port 1455 to select manual handoff. It validates provider endpoint, POST payload, client/resource, PKCE verifier and exact exchange count. Codex startup's global-fetch polyfill assignment is intercepted by a stable test-owned getter/setter.
- OS isolation denies external egress independently of the fetch guard. `unexpectedFetchRequests` counts guarded fetch/preconnect violations only. Direct socket attempts and loopback traffic are not audited.
- GNU `timeout` bounds the namespace process group; the PTY driver has a separate child watchdog. Parent cleanup removes owned profiles. Raw PTY output is never emitted on failure.

Success requires the CLI's login status, exact provider-scoped synthetic credentials, expiry, mode `0600`, OpenAI issued-client/scopes or Codex account ID, one matching PKCE exchange, and restored-editor `/quit` exit zero. Denial and state rejection require their expected error class and no credentials. Cancellation requires no exchange or credentials and a responsive restored editor. An exchange receipt alone cannot pass.

## Reproduction

Linux network namespaces, passwordless `sudo -n` for the namespace launcher, `ip`, `setpriv`, GNU `timeout` and Bun PTYs are required. Missing prerequisites fail the explicitly enabled suite; there is no unsandboxed fallback.

```sh
bun run test:local --cwd runtime \
  --env PICLAW_RUN_AUTH_CLI_TESTS=1 --env PICLAW_E2E_DISPOSABLE=1 -- \
  bun test --timeout 600000 test/agent-control/provider-auth-cli.optional.test.ts \
  test/agent-control/provider-auth-cli-receipt.test.ts
```

Ordinary canonical CI validates the receipt and isolation refusal; the opt-in suite executes all eight terminal flows separately.

## Initial failures

The first probe lacked OS isolation. Bundled Codex startup replaced global fetch and the probe returned provider-facing token-validation text. It was stopped and excluded from qualification. Disposable credentials were synthetic; that run's network behaviour was not fully audited. All subsequent CLI qualification uses mandatory OS isolation.

The first guarded parent test failed before CLI startup because mounted `/sys/class/net` reflected the container namespace. Namespace-local `/proc/net/dev` fixed the check. Later assertions used `scope` rather than the SDK's stored `scopes` array, and mismatched the providers' denial/state-error wording. Those runs failed; source inspection corrected the field and exact error classes without relaxing expected scopes or rejection. The final focused run passed 3 tests / 104 assertions.

## Evidence boundary

This receipt covers the official Earendil interactive CLI package and two providers with synthetic exchanges. Piclaw distributable CLI/card routes, Node terminal behaviour, automatic browser callback, live accounts, provider token validation, refresh/logout through the CLI, historical credential cleanup, Delegate parity and native MCP acceptance are unqualified. #1442 and #1458 stay open. No deployment or restart occurred.

At baseline `717d1b2b87b8ad9351e88cfd6b5135c501299508`, `make ci-fast` passed 5,972 runtime tests, eight existing/opt-in skips and no failures, plus 25 feature tests and nine web checks. The optional PTY suite ran separately: three tests / 104 assertions, covering all eight flows and receipt/refusal checks. Pack hygiene passed 24,742 files. Five typechecks, scoped strict fixture typing, Oxlint, silent-swallow, local-entrypoint and diff checks passed; compose retains 95 unchanged diagnostics. Independent review findings were fixed and re-reviewed with no blockers. Private Bun caches were used without shared-cache permission changes.
