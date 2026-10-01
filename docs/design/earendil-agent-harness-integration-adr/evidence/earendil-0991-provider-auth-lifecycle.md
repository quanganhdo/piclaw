# Offline provider-auth lifecycle on Earendil 0.99.1 (#1458)

Public `ModelRuntime` auth operations now have a disposable Piclaw `FileCredentialStore` integration fixture. It exercises synthetic providers against exact published `pi-ai` and `pi-coding-agent` 0.99.1. This slice adds bounded AUTH-04/06 evidence; #1458 requires further artifact, UI, external-provider, Delegate and approved live-account qualification.

## Tested operations

The fixture imports the two packages through their public root exports. It registers a typed synthetic provider through `registerNativeProvider()` and calls `login()`, `getAuth()`, `listCredentials()`, `refresh()` and `logout()`. The real Piclaw file store owns persistence and locking. No private runtime member, compatibility cast or source-tree SDK substitution is used.

| Scenario | Assertions |
|---|---|
| Login, persistence, reopen, logout and relogin | OAuth survives runtime recreation; credential listing contains only exact provider/type metadata; auth file/directory permissions are 0600/0700; logout changes only the intended provider; an existing runtime sees logout and relogin through the shared store |
| Expired OAuth rotation | `getAuth()` refreshes once; access, refresh token and expiry persist; a recreated runtime uses the rotated credential without another refresh |
| Concurrent runtimes | Two runtime/store instances contend on one file in the same child process; one provider refresh supplies both results and the persisted rotated refresh token |
| Failed refresh | Exact OAuth `invalid_grant` failure preserves the complete stored credential and unrelated provider; no API-key fallback is consulted; a later successful retry uses the preserved credential |
| Cancelled/rejected login | Cancellation propagates the supplied abort reason; explicit provider rejection is distinguished; both failures preserve the complete working OAuth credential |
| Stored API key and ambient source | Stored synthetic key takes precedence; empty-key login rejects without replacing it; logout removes the stored key and reports the remaining synthetic environment source without deleting that environment value |

Each case runs in a fresh child with a disposable HOME, agent directory and profile. The parent supplies a minimal environment, disables env-file loading and telemetry, and waits for child exit before removing its files. Provider inference methods throw if called. A child-owned fetch guard rejects network/preconnect attempts and the case asserts that none occurred. Neither cloud metadata nor real credentials are used. Synthetic credentials are written only to private temporary auth files; successful output contains only the scenario name.

Runtime registration starts an offline availability refresh. An explicit public refresh is awaited before each scenario. The fixture does not replace the runtime's methods or auth store with a mock implementation.

## Reproduce

```sh
bun run test:local --cwd runtime -- bun test test/agent-control/provider-auth-lifecycle.test.ts
bun run test:local --cwd runtime -- bun test test/agent-control/provider-auth-lifecycle.test.ts test/agent-control/provider-auth-inventory.test.ts test/agent-control/provider-auth-isolation.test.ts
```

The reviewed lifecycle/inventory/isolation set passed 30 tests and 164 parent assertions, with additional child assertions for every lifecycle boundary. Review tightened complete-credential preservation, exact metadata output and rejection-cause checks; rereview found no blocker. Strict fixture typechecking, scoped lint and all five standard typechecks passed. The compose check retains its unchanged 95-diagnostic transitive baseline.

At merged baseline `bb106bc8515e844b9370945c394194b6feb0d2d2`, `make ci-fast` passed 5,919 runtime tests with seven existing skips and no failures, 25 feature tests and nine web checks. Pack hygiene passed 24,741 files; final standard typechecks and diff checks passed. Validation used a private Bun install cache and did not change shared-cache permissions.

## Further qualification

Concurrency here uses two runtime instances in one process. Independent-process token rotation, lock compromise, interruption and crash durability need separate receipts. The fixture recreates a runtime over the current credential file; it does not restore a superseded OAuth snapshot. After real refresh-token rotation, restoring an old snapshot may require reauthentication. Never treat a previous refresh token as a safe rollback credential.

The ambient-source case uses a synthetic provider. It does not qualify Bedrock, Vertex, Azure, keychain resolution, delegated child credential inheritance or provider-specific revocation. The six cases also do not exercise Piclaw's standalone artifact, browser/device-code flows, backups/traces or full SDK-session/UI activation. The earlier isolation and inventory receipts cover their own narrower boundaries. Required live login/refresh/logout checks still need explicit approval or waiver; billable inference needs separate approval.
