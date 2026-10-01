# Packed Piclaw SDK auth on Earendil 0.99.1 (#1458)

The packed Piclaw model-services stack completes synthetic OpenAI and Codex login, token rotation, runtime reopen and scoped logout in a disposable install. This is packed-artifact evidence for AUTH-02/04 using public SDK auth methods and internal Piclaw runtime construction. CLI `/login`, provider-selection cards, web UI and device-code acceptance still need separate receipts.

## Artifact and execution

The opt-in test runs `bun pm pack`, hashes the resulting Piclaw tarball and installs it into an isolated consumer prefix with `bun add`. Package installation may download dependencies; it inherits an empty account environment and uses a private Bun cache. The consumer is copied into that prefix and resolves packed Piclaw `model-services.ts` plus public SDK root exports from inside the prefix. Realpath checks reject entrypoints outside it or a prefix inside the checkout.

Archive-extracted `model-services.ts` and `credential-store.ts` hashes must match installed bytes. Five fingerprints also pin the installed SDK root/runtime and OpenAI/Codex auth files to exact 0.99.1. File reads provide provenance. Auth interactions use public `ModelRuntime` APIs; runtime construction uses the packed internal Piclaw application entrypoint. This does not create a new stable Piclaw library export.

The consumer calls the packed `createRuntimeModelServices()` and public `ModelRuntime.login/getAuth/logout`. It occupies loopback port 1455 and handles the supported manual redirect prompt; it asserts the provider-specific callback hostname/port, state handoff and PKCE challenge. Every token fetch checks the provider endpoint, grant, client ID, resource and refresh token before returning synthetic data.

OpenAI and Codex receive distinct account and refresh-token sentinels. Both credentials coexist while each rotates and survives a recreated runtime. Codex logout preserves the full OpenAI credential, then OpenAI logout preserves an unrelated provider. Credential listing is metadata-only, and `auth.json` permissions are 0600. The consumer emits hashes, relative entrypoint paths and aggregate outcomes, never token/redirect values.

The fetch/preconnect guard records unexpected calls through those APIs. It is not an OS network sandbox and does not intercept every HTTP/socket/subprocess transport. The exact tested provider flows use fetch. No inference method is invoked. Full secret scans across failures, traces and backups need separate coverage.

## Receipt

The [Bun receipt](receipts/earendil-0991-packed-provider-auth-bun.json) was generated from source commit `4c11e4710b3f353a1b935e95ad96d071c05510ee`, Piclaw 3.2.5 and Bun 1.4.2. It records the tarball SHA-256, archive/installed Piclaw module hashes and installed SDK file hashes. The built tarball SHA-256 is `2eba68bc57b0beb3085330908f9ba10e8a76198ee0fe137fe4986ba3c3114550`. This is a locally built artifact, not a published release or a deployed runtime. The merged lifecycle tests are excluded from the package, so this tarball has the same hash as the earlier inventory-baseline build.

Reviewed fingerprint-enforcing execution passed one opt-in test with 13 parent assertions and the consumer's additional auth/provenance assertions, including a repeat after merging lifecycle #1471. Receipt SHA-256: `9a3d64f8e9ef68b31ef139733285400c4247d702df2e0610fbaffbb6b310e3c6`. Independent review corrected a provider-identity false-pass risk and rereview found no blocker within SDK-artifact scope. The post-merge lifecycle/inventory/receipt set passed 11 tests and 114 assertions; strict fixture typechecks and scoped lint passed.

`make ci-fast` passed 5,920 runtime tests with seven existing skips and no failures, 25 feature tests and nine web checks. Pack hygiene passed 24,741 files. Final five typechecks and diff checks passed; the compose check retains its unchanged 95-diagnostic transitive baseline. The environment observation snapshot was refreshed only for documentation references to the opt-in variables; production readers are unchanged. All validation used private Bun caches.

## Reproduce

Build the web assets first, then use the controlled disposable test launcher:

```sh
make build-web
BUN_INSTALL_CACHE_DIR=/path/to/private-cache \
  bun run test:local --cwd runtime \
  --env PICLAW_RUN_AUTH_ARTIFACT_TESTS=1 --env PICLAW_E2E_DISPOSABLE=1 \
  -- bun test --timeout 540000 test/agent-control/provider-auth-artifact.optional.test.ts
```

`PICLAW_AUTH_ARTIFACT_RECEIPT` optionally selects a caller-owned output file. The test runs pack, staged install and auth execution locally; ordinary CI excludes opt-in tests, so a skipped run is not a new artifact receipt. The callback port must be free before execution. Test subprocesses have bounded timeouts and the owned profile/install is removed after exit.

## Further qualification

This receipt exercises the packed SDK stack without a real session/card transport. It does not validate the complete CLI or web login route, automatic browser launch, device polling, live accounts, Delegate child CLI, cross-process crash durability or rotated-token rollback. Native MCP/storage gaps still require a public seam or explicit target/scope decision. #1458 and #1442 stay open; no deployment or restart follows this test.
