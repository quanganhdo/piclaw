# Transient provider-auth presentation (#1458)

Provider-emitted URLs, device codes, messages and prompt metadata stay in the live auth flow. Persisted runtime-auth cards contain generic copy and opaque owner/action references. The private dialog retrieves sensitive instructions through the existing authenticated card callback with `Cache-Control: private, no-store`, `Vary: Cookie` and `Referrer-Policy: no-referrer`.

## Delivery boundaries

The callback requires the initiating chat, source post and active card action. It never falls back to another chat for authentication actions. The runtime validates the session object, session generation, runtime identity, provider flow, deadline and one-use action ID. A private-response AsyncLocalStorage scope admits presentation only during the direct HTTP callback; ordinary control surfaces cannot request the sensitive result.

Reveal rotates the action before returning. The callback replaces the source post with a generic card containing no provider-emitted URL, code, message, prompt metadata or submitted value, then commits delivery and broadcasts only that card. The implemented runtime-auth path is tested not to persist or broadcast raw provider material. Multi-step continuation and polling follow the same transient path. Terminal completion sends a generic result/model-activation card; it never auto-selects a model. Cancel deletes the flow without exposing provider material.

If reveal persistence fails, the previous reveal action is restored when still current. Submitted provider input cannot be undone; failed continuation delivery aborts and deletes the flow so retry cannot replay that input. Failures after committed persistence can delay UI feedback but do not restore consumed actions.

Progress events are coalesced by type, preserving the latest URL, code and information. Device-code expiry shortens the five-minute flow ceiling where the provider supplies a shorter deadline. Backend deadline checks deny stale actions before timer dispatch.

## Browser behavior

Both classic and visual renderers use the same transient dialog. Provider text is rendered with DOM `textContent`; links accept only HTTP(S) without URL credentials and use `noopener noreferrer`. No provider URL is opened automatically. PKCE/state parameters stay intact in the in-memory URL and are not copied into timeline cards.

Secret input is password-styled. Closing, expiry or page navigation removes the dialog DOM, clears input/options/action data, aborts pending requests and scrubs mutable submission values. A captured click guard prevents expired links/actions even if a timer is delayed. The tested dialog implementation contains no browser-storage, timeline-write or broadcast operation.

## Offline validation

This is partial AUTH-03/05 evidence. Full provider-auth qualification is incomplete.

The focused handler/isolation/card-service set passed 52 tests and 408 assertions. Tests cover sentinel-bearing auth URLs, device codes, info/progress and prompts, exact metadata binding, foreign chats, replay, session/runtime replacement, disposal, shorter code deadlines, failed reveal delivery and failed continuation delivery. A multi-step synthetic provider exercises the actual handler and DB-backed card service; persisted source rows, safe broadcasts and result messages contain no sentinel.

Disposable Chromium and WebKit fixtures passed two tests and 34 assertions. They exercise the password dialog, explicit single-model activation, unsafe URL/HTML rejection, expiry removal and abortion of a stalled request on close. No real account, OAuth endpoint, cloud metadata or inference is used.

All five typechecks passed with the unchanged 95-diagnostic compose baseline. Scoped lint passed for the changed backend/dialog/tests/renderers. Full-file lint of `api.ts` reports one pre-existing `no-useless-assignment` error in unrelated SSE code; the same error was reproduced from merged baseline `3cb9835ccf9ead1654c76980ca81ad072d8d530a`. The only API change adds AbortSignal forwarding to card submission.

At merged baseline `3cb9835ccf9ead1654c76980ca81ad072d8d530a`, `make ci-fast` passed 5,926 runtime tests with seven existing skips and no failures, 25 feature tests and nine web checks. Pack hygiene passed 24,741 files; final five typechecks and diff checks passed. Private Bun caches were used, without changing shared-cache permissions. Independent review findings were fixed; final backend/dialog rereviews found no blocker within this partial scope.

## Remaining qualification

This slice changes new runtime-auth cards. It does not rewrite historical cards, complete all provider-specific device polling/denial/retry cases, certify backup/trace scans, qualify Delegate children or authorise live login/refresh/logout. The browser fixtures use a disposable test server with synthetic providers rather than a deployed production instance. Required live canaries still need approval or explicit waiver, with inference separately authorised. #1458 and #1442 stay open.
