# Public runtime credential error isolation

Piclaw's public `ModelRuntime.stream` and `streamSimple` emitted raw credential-refresh diagnostics before this fix. A synthetic expired OAuth credential produced a private sentinel in both terminal error events and `result()`, with zero provider inference calls. Earendil 0.99.1 `ModelsError` appends cause text and lazy stream setup turns that message into an assistant error.

## Protected boundary

`createRuntimeModelServices` now injects a public `CredentialStore` facade around the app-owned backing store. It forwards `read`, `list`, `modify`, `delete`, provider IDs, callback identity and operation options unchanged. The backing store completes its locking, retry and persistence behaviour before the facade handles a rejected operation; the original store remains available internally.

The facade replaces diagnostics with a new error without the original message, cause, stack or custom properties:

| Failure | Public message | Recovery category |
|---|---|---|
| Permanent or unclassified | `Provider login required. Model credentials could not be resolved.` | `auth_config` |
| Transient | `Model credential service temporarily unavailable (503).` | `network` |
| Cancellation | `Credential operation aborted.` (`AbortError`) | `aborted` |

Transient classification uses the existing private OAuth/store classifier after its retry sequence completes. It never forwards raw diagnostics. Getter/proxy inspection failures fall back to the permanent generic message; secondary exceptions cannot escape. Error-like and `DOMException` cancellation names are recognised under that guarded inspection.

## Synthetic qualification

Public runtime tests execute both stream methods with a native synthetic provider and app-owned file store:

- permanent refresh failure makes one refresh attempt per stream, exposes only the generic auth message and retains old credentials;
- exhausted transient refresh makes two real store-managed attempts per stream, preserves network recovery classification and old credentials;
- malformed storage exposes only the generic auth message;
- successful retry is tested through public `getAuth`: first refresh throws, second rotates, subsequent resolution reuses the committed credential.

All cases forbid provider inference and network requests. Captured logs and stream event/results must omit the private sentinel. Unit tests cover every store operation, argument/callback/result forwarding, hostile diagnostic getters, cancellation with signals and `DOMException`, and public recovery classification. Existing store/lifecycle tests remain unchanged apart from the service-injection identity assertion.

## Failures and scope

Initial child tests reached their assertions but timed out because the process stayed alive after the result. No public runtime disposal API was found. The owned fixture now exits explicitly after assertions, fetch restoration and profile cleanup; natural runtime teardown is unqualified. A retry-success assertion initially used `AuthResult.apiKey` instead of public `AuthResult.auth.apiKey`; it failed and was corrected from the public declaration. Review also found diagnostic-getter and `DOMException` cancellation gaps; both were fixed and re-reviewed.

The facade protects rejected app-owned credential-store operations entering Piclaw's runtime. Direct backing-store callers, provider login/`toAuth` failures outside store operations, unrelated provider transport errors, historical data, live providers, Delegate parity and native MCP acceptance are outside this receipt. No live credentials, inference, deployment or restart.

## Validation

Focused regression/lifecycle/store set: 43 tests / 243 assertions. Five typechecks, strict fixture typing, scoped Oxlint, silent-swallow, local-entrypoint and diff checks pass. Independent review has no remaining blockers. At baseline `53b9c529590e1d703633ea05cb5aeb5d80f278f0`, `make ci-fast` passed 5,988 runtime tests, eight existing/opt-in skips and no failures, plus 25 feature tests and nine web checks. Pack hygiene passed 24,743 files; final five typechecks passed with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without shared-cache permission changes.
