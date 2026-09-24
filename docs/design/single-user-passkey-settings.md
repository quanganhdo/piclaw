# Single-user passkey Settings

Single-user owners need to enrol several passkeys and manage them from **Settings → Authentication → Passkeys** in both Classic and Visual.

Status: implemented on an isolated feature branch, not deployed. The [Gherkin feature](../../tests/e2e/features/shared/single-user-passkey-settings.feature) maps to the [implementation evidence and device-test limits](../reviews/single-user-passkey-settings.md). Syntax validation alone is not behaviour evidence.

## Scope

- List registered credentials with a name, distinguishing identifier, creation time and last-used time. Show an honest empty state after a successful empty response, and an error rather than an empty list after a failed read.
- Add a first passkey from a valid TOTP-authenticated owner session, or add another from a passkey-authenticated session in passkey-only mode. Do not require a configured TOTP secret for the latter.
- Use the browser's native WebAuthn prompt. Do not require slash commands, a token-bearing link, custom authenticator selection UI or registration secrets in chat.
- Rename and remove individual credentials. Persist labels; do not infer device names or enumerate physical devices from a synced passkey.
- Keep existing credentials, counters, relying party IDs and single-user account ownership. Reuse the credential store and server verification library; do not copy credentials into a new store or switch access mode.
- Report loading, cancellation, failure and uncertain results truthfully. Reconcile with server state after a lost response instead of repeating a consumed ceremony.
- Use direct authenticated server requests for Settings operations. Fix the unused Visual passkey list/delete calls and tokenless enrolment link; do not bridge Settings through agent chat commands.

Out of scope: switching to family mode, redesigning TOTP enrolment, creating a new offline recovery mechanism, exporting private keys, manually syncing passkeys, or redesigning session management. The single-user route must not accept an account selector or act as a family-account management shortcut.

## Implementation policy

The owner's instruction to complete implementation uses these conservative defaults:

| Decision | Rule | Scenarios |
|---|---|---|
| Recent authentication | Listing requires a valid owner session. Add, rename and remove require successful factor proof within five minutes, bound to that session. Passive activity does not renew this proof; re-authentication in one browser does not authorise another. | 019, 026 |
| Last usable factor | Refuse removal if no accepted sign-in factor remains for the default owner and current RP ID. TOTP counts only when configured **and accepted by the effective login policy** (legacy single-user TOTP has no separate enrolment-verification flag). Enforce atomically at commit; legacy delete commands cannot mutate credentials. | 020–023 |
| Existing sessions | Removal prevents future assertions with that credential; it does not implicitly revoke existing sessions. State this in confirmation. A future session-management policy can change it explicitly. | 024 |

A registered passkey is not proof the owner still possesses the authenticator. The server checks registrations and policy; it cannot count physical copies of a synced key or guarantee that a backup device is reachable.

Label validation follows the existing account label limit of 80 Unicode characters, trims surrounding whitespace, and treats markup as text. IDs distinguish duplicate display names. Existing unnamed credentials stay usable and display a stable fallback until renamed.

“Either” in the feature means the effective login policy permits both TOTP and passkeys. A stored TOTP seed in passkey-only mode is not fallback. A session cookie, internal automation token, uncompleted enrolment, or credential for another RP is not fallback either.

## Original code and gaps

These findings describe the pre-implementation baseline `2e4aa4f1b`; the evidence note records the changes.

- `runtime/src/db/webauthn.ts` stores multiple credentials per user and RP. `webauthn-auth.ts` excludes existing credentials during creation and verifies login assertions against the matching credential.
- `runtime/src/agent-control/handlers/passkey.ts` supplies single-user list/enrol/delete commands. Its enrol action currently requires a TOTP secret. Its delete action does not enforce a last-factor guard.
- Visual's `AuthenticationSection.tsx` calls `/agent/passkeys` and `/agent/passkeys/delete`; no matching runtime routes were found. The enrol link has no token, but `webauthn-enrol-page.ts` requires one.
- `runtime/src/db/account-administration.ts::requireAccountActor` explicitly requires family-shared mode. Its five-minute freshness and factor-counting rules are useful references, **not** a single-user authorisation function that can be called unchanged.
- `runtime/src/db/account-security-labels.ts` already supplies account-scoped label validation. No new credential storage should be needed for labels.
- Single-user `isRequestAuthenticated` permits requests when auth is disabled. Settings credential management must require a real authenticated owner, not inherit that general no-auth fallback.

## Test plan and evidence boundaries

Each `@ux-single-passkeys-NNN` identity maps to a distinct scenario or outline. Bind them during implementation; do not count parsing or source-text checks as browser behaviour.

| Layer | Required evidence |
|---|---|
| DB/service | Preserve legacy rows; persist labels across reopen; reject duplicates; enforce identity/RP scoping; transactionally prevent concurrent last-factor removals; check effective policy at write time. |
| HTTP | Real owner sessions; fresh/stale proof; unauthenticated and internal-token-only denial; origin and ceremony binding; consumed/expired challenge; session revocation during native prompt; family/single-user route separation. |
| Browser | Real shipped Settings entrypoints in both skins, backed by disposable endpoints. Verify first load, reload, list refresh, form state and error propagation. No hook-only fixture can establish route wiring. |
| WebAuthn protocol | Chromium virtual authenticators for registration and independent fresh login with each credential, including passkey-only with no TOTP. Separate virtual authenticators/profile state where needed. |
| WebKit and devices | Settings/keyboard/narrow-layout coverage in Chromium and WebKit; manual Safari/iPad/native security-key and synced-provider checks where virtual automation cannot exercise the OS prompt. Mark manual checks as outstanding until performed. |

Run UI cases in both skins at desktop width and 390 px; include tablet/Safari for the native-prompt focus case. Assert real registration success only after server verification. Browser cancellation or a stubbed success dialog is not cryptographic verification evidence.

Use only disposable instances and owned test stores. Do not create, rename, delete or exercise passkeys in Smith's live account to validate this feature. Native prompt cancellation may leave a credential in the user's authenticator if the server completion failed; the UI must not claim it deleted authenticator-side data.

Acceptance requires passing automated checks mapped to the scenarios, documented manual device results or explicit gaps, and review of server-side authority/lockout controls. Merge and deployment require separate approval.
