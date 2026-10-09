# Pi 1.0.0 Anthropic and OpenRouter login methods

The public Anthropic browser/copy-code and OpenRouter browser methods pass 37 synthetic cases under Bun 1.4.2. Anthropic 1.0.0 adds a method selector and a listener-free copy-code branch; its localhost browser callback still exists. Full web/CLI routes, token-policy validation and live-account acceptance are separate work in #1495/#1458.

## Exact target and cases

Target: Pi `1.0.0`, gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`, based on admitted Piclaw merge `5cc738d7c`. The fixture imports only public provider exports. It checks the installed version and SHA-256 bytes of Anthropic, OpenRouter, the shared callback server and PKCE implementation before invoking auth methods.

Twenty browser cases retain both providers' manual/callback success, invalid-first callback, denial, malformed JSON, prompt/exchange cancellation and pre-abort behaviour, with Anthropic state mismatch and OpenRouter missing-key cases. Anthropic selection returns `browser`; its authorize and exchange redirect remains `http://localhost:53692/callback`. Exact IPv4 binding, absence of a same-port IPv6 listener, callback status/cache headers and port reuse after settlement are checked. OpenRouter receives no method-selector prompt.

Seventeen Anthropic copy-code/selection cases cover:

- `code#state`, bare code, query form and full callback URL;
- an unrelated URL carrying a code and matching state;
- empty input and mismatched supplied state;
- token denial and malformed JSON;
- prompt/exchange cancellation, refresh denial and refresh cancellation;
- unknown method selection, cancelled selection, and two pre-aborted host-prompt paths.

Authorize and exchange redirects are exactly `https://platform.claude.com/oauth/code/callback`. Request shape, PKCE verifier/challenge, state, client ID, returned credentials, expiry window, refresh rotation and `toAuth` projection are asserted. No TCP/TCP6 listeners were present at prompt, notification, mocked request and post-settlement observation points. This is boundary sampling, not a continuous socket audit.

The SDK accepts unrelated URL-form code input. The exchange still uses its fixed redirect; the input URL is not followed. Missing state uses the generated verifier, while a supplied mismatched state rejects before token exchange. These are measured parsing behaviours, not general URI or token-policy guarantees.

## Cancellation ownership

The Anthropic selector descriptor has no signal. In the fixture, the host prompt rejects an already-aborted interaction. Browser pre-abort and `pre-abort-selection` therefore record `host_selection_prompt`; they do not prove an SDK selector abort check.

`pre-abort-manual` deliberately allows selection despite the aborted signal. The SDK emits its authorization notification and calls the manual prompt with the interaction signal; the host rejects there. Its receipt records `host_manual_prompt_after_sdk_notification`. OpenRouter's existing pre-abort path records `sdk_before_notification`.

Mid-prompt and transport aborts are case-driven, distinct from watchdog failures. The mocked exchange/refresh transport observes cancellation. Every case has a deadline; each settled case has a 100 ms late-event/request observation window. Longer or unobserved late activity is unqualified.

## Isolation and evidence

Execution requires a distinct loopback-only Linux network namespace before provider imports, an unprivileged UID, no capabilities or supplementary groups, and `no-new-privs`. The parent creates the namespace and drops privileges. Children receive a minimal environment with a nonexistent home, disabled telemetry and no credential paths. Fetch/preconnect guards reject import-time requests; mocked exchanges assert exact endpoints and bodies. Only test-owned loopback callback requests reach sockets.

No live credentials, browser account, inference, MCP connection, credential persistence, installation into the running service or restart is used. This is not a filesystem sandbox or exhaustive network-syscall audit. Response/token schema validity beyond the asserted fields and public error diagnostic redaction are not qualified here. Private flows and public timeline/export redaction remain separate gates.

Receipt: `receipts/earendil-100-provider-browser-bun.json`. The optional execution test compares a fresh run with that receipt and checks that initial and rotated synthetic credential sentinels are absent from output. The mandatory receipt test verifies all case identities, ownership/count expectations and exact installed implementation fingerprints. A separate refusal test verifies that ordinary-namespace execution fails before provider imports.

The 0.99.1 browser fixtures and receipts remain unchanged historical evidence. No old callback receipt is relabelled as 1.0.0, and the copy-code path does not remove the retained browser callback.

## Validation

- First execution: all 37 cases passed; first repeat/receipt/refusal set: three tests, 444 assertions.
- Independent review found missing pre-abort ownership labels and omitted rotated-browser output sentinels. Both were corrected.
- Corrected fresh execution and repeat/receipt/refusal set: three tests, 484 assertions, zero failures.
- Final receipt assertions also cover browser callback/refresh counts, PKCE and cancellation flags. Fresh repeat/receipt/refusal set: three tests, 599 assertions, zero failures.
- Independent corrected-delta review found no blocker. Five typechecks and scoped lint pass; compose retains 95 pre-existing diagnostics.
- Frozen full `make ci-fast`: 5,900 current-runtime passes, eight existing skips, zero failures; 37,743 assertions across 849 files in 881.42 seconds. Twenty-five feature tests, both frontend builds and nine web checks passed. Separate frozen 0.99.1 replay: 468 passes, zero failures, 8,720 assertions across 45 files.
- Final pack hygiene: 24,746 files. Five typechecks passed again; final isolated execution/receipt/refusal repeat: three passes, 599 assertions.
- Initial full gate stopped before tests because the new document's test-flag references made the environment-documentation index stale. Regeneration added only two document-path references; production readers were unchanged. The corrected frozen gate passed; the first failed log is retained.

Frozen tree: `5ed59e4604b99dcc43389a0ad88676c168fd3098`. Full log: `/workspace/tmp/1495-browser/ci-fast-v2.log`, exit zero, SHA-256 `083ad9b758f13d920f28557bc17f7ae6b016f0f008340b7f33039afe7601d3f5`. Only this evidence text changed after the full gate.

To run the synthetic matrix through the repository launcher, enable `PICLAW_RUN_AUTH_BROWSER_MATRIX=1` and `PICLAW_E2E_DISPOSABLE=1`, then select `test/agent-control/provider-browser-matrix-100.optional.test.ts`. The process must be able to create the required network namespace. These flags do not permit live provider calls.
