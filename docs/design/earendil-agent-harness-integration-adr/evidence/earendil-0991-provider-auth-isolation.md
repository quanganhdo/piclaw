# Provider auth isolation slice for Earendil 0.99.1 (#1458)

Provider login and logout interactions now bind to the initiating AgentSession object, chat, session generation and ModelRuntime. This is a partial offline security slice for #1458; it does not complete AUTH-01–08 qualification or approve live account operations.

## Changed boundaries

- Each auth flow has an opaque flow ID and a one-use action ID. New provider prompts and rendered cards rotate the action ID. Foreign, stale, replayed, expired or replaced-session submissions cannot resolve the prompt.
- Only one handler-owned login operation per runtime/provider can remain active across OAuth/API-key methods and sessions. Replacement aborts the older flow. Login and logout operations are serialised; logout joins an already-admitted credential write before deleting it, and a newer login waits behind logout.
- Session disposal aborts pending prompts and clears flow/activation state. Owner/generation/runtime checks fence results after asynchronous waits. The runtime retains ownership of credential writes and deletion.
- Login refreshes available models but never selects one automatically. Even one available model requires an explicit, owner-bound, expiring activation action. Provider revisions invalidate activation permits after logout or reauthentication.
- Logout confirmation has its own expiring one-use permit bound to owner and provider revision. Old confirmation cards cannot delete newly installed credentials. Direct logout from a disposed session is denied.
- Provider error messages can contain keys, codes or token-bearing URLs. Runtime-auth failure logs record a generic outcome, and UI errors use a generic retry message without the raw provider error.
- Auth input values pass only to the in-memory control handler. Completed card state retains an allowlisted action identity and generic title; it omits keys, passwords, redirect codes and custom form values. A login source card rejects substituted non-login actions and changed action bindings before mutation.
- Custom-provider configuration forms do not prefill a stored API key. The credential entry field uses password styling.
- Direct provider login/logout handlers reject family-shared and isolated-container modes before touching session/runtime credentials, matching the existing instance-owner control-plane policy.

## Offline execution coverage

Synthetic ModelRuntime tests cover foreign session/chat, same-provider replacement, different auth methods, consumed prompt IDs, expiry, disposal, generation/runtime changes, secret-bearing errors, explicit model activation, provider-specific activation expiry, logout during refresh, late admitted writes, pending logout, stale removal confirmation and stored custom-key prefill.

Database-backed card tests submit secret sentinels and inspect completed source-card state. They also reject substituted intent/provider/flow data before the handler or generic submission persistence. Disposable Chromium and WebKit fixtures render the shipped Adaptive Card renderer, fill a password prompt, continue the bound flow and verify that only the explicit activation button changes the model. Browser fixtures use fake credentials and a test-only HTTP server, with external requests denied.

The final lifecycle/card/multi-user focused set passed 51 tests and 460 assertions. Chromium and WebKit password/activation fixtures passed two tests and 16 assertions. All five typechecks passed (the compose check retains its unchanged 95-diagnostic baseline), scoped lint reported no warnings/errors, and `make ci-fast` passed 5,909 runtime tests with seven existing skips, 25 feature tests and nine web-build/static checks. Bounded independent reviews found no confirmed blocker in the provider mutation queue, card-persistence and final activation guards after the earlier findings were fixed.

No live credential, OAuth/device login, logout/revocation, provider refresh or billable inference is used. This receipt validates synthetic interaction and persistence boundaries, not the full provider matrix.

## Qualification still required

| Gate | Disposition after this slice |
|---|---|
| AUTH-01 provider/method inventory | Exact runtime and custom/external matrix still needs its execution receipt |
| AUTH-02 packaged OpenAI/Codex login | Module presence alone is insufficient; built-artifact mocked-network flow still required |
| AUTH-03 complete interactions | Basic secret/text/select/multi-step, cancellation and activation regressions exist; device/browser denial/retry/timeout matrix is incomplete |
| AUTH-04 credential lifecycle | Handler races covered; refresh/rotation, concurrent-process store, relogin and external-source status need separate receipts |
| AUTH-05 secrets/isolation | This slice covers flow/action state and submitted inputs. Provider-owned auth URLs/device codes/events, custom configuration persistence/backups, traces and complete account policy require further review |
| AUTH-06 external/custom auth | Existing configuration semantics retained; API-key source precedence and all cloud/local cases not fully qualified |
| AUTH-07 Delegate availability | Explicit activation enforced. Exact parent/child credential resolution and Delegate approval/tier gates still require #160 evidence |
| AUTH-08 recovery/release | No live canary or waiver. Rotated-token rollback and immutable artifact/UI qualification remain required |

No adapter removal, native MCP cutover, deployment or restart follows these checks. #1449/#1450 public native MCP gaps still block #1454–#1456.
