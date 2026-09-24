# Single-user passkey Settings implementation

Classic and Visual now share a passkey management component under **Settings → Authentication**. It lists the default owner's existing credentials, adds another with a native browser prompt, renames labels and removes one credential at a time.

## Server contract

- `GET /agent/passkeys` returns names, shortened-display identifiers, relying party IDs, creation/last-use times and action eligibility. Public keys, counters and authentication secrets are not returned. Replies are not cached.
- `POST /agent/passkeys` accepts `rename` or `remove`; the selected credential is scoped to the default owner. It accepts no account selector.
- `POST /agent/passkeys/register/start` and `/finish` use SimpleWebAuthn verification. An opaque, single-use challenge binds the original owner session, RP, origin and validated label. Pending ceremonies expire after five minutes and are memory-only; restart invalidates them, while registered credentials persist.
- Reads require a real default-owner login with an enabled account and a currently accepted login method. Writes also require same-origin requests and authentication no older than five minutes. Internal tokens, anonymous no-auth mode and family principals cannot substitute for that session.
- Sign in again opens the existing login page in a separate tab. After proving an accepted factor, the owner returns to Settings and selects Refresh. The browser receives a fresh session cookie; activity alone never extends proof freshness. Other browser profiles retain their own sessions.
- Removal rechecks the session and current factor policy in an immediate SQLite transaction. Another current-RP passkey or configured, accepted TOTP must remain. A TOTP secret in passkey-only mode, another RP's key or an existing session does not count. Removal does not silently sign out existing sessions.
- Registration verifies resident-key and user-verification-capable credentials without requiring a TOTP secret in passkey-only mode. Duplicate IDs never replace existing key material. Session revocation or changed policy during verification prevents commit.
- POST bodies are limited to 64 KiB and ten seconds. Mutations are rate-limited. Error responses contain no cryptographic payloads.

No new credential table is introduced. Existing `webauthn_credentials` labels and creation dates are retained. Newly created keys have no last-use date until they successfully authenticate.

## Legacy enrolment change

A security review found that leaving the legacy bearer-token enrolment path open would bypass the new session-bound ceremony. Single-user `/auth/webauthn/register/start`, `/finish` and `/auth/webauthn/enrol` now return 410 with Settings guidance. Previously issued single-user enrolment links no longer work.

`/passkey enrol` now directs the owner to Settings without minting a link. `/passkey delete` refuses removal and directs the owner to Settings; agent commands have no browser-bound recent proof. Listing remains available. Family-account registration remains on its existing authorised path and its regression tests are retained.

## Acceptance evidence map

IDs refer to `single-user-passkey-settings.feature`. The repository's Gherkin files are acceptance contracts; executable checks use its isolated Bun/Playwright launcher, not generated Cucumber step bindings.

| Scenario IDs | Executable evidence |
|---|---|
| 001, 006, 008, 009, 013, 016, 024 | `test/web/passkey-settings.playwright.optional.test.ts` — Classic/Visual controls, rename, removal/cancel, read errors, narrow layout and session explanation. `passkey-settings-shell.playwright.optional.test.ts` additionally loads the real built app entrypoints, opens Authentication and renames a credential in both skins and browser engines. |
| 002, 003, 007, 008, 012, 017–023, 026 | `test/channels/web/auth/single-user-passkeys.test.ts` — direct API/session authority, first TOTP enrolment, passkey-only enrolment, name validation, token reuse, other-session rejection, policy changes, concurrent removal and legacy bypass denial. |
| 004 | `test/web/passkey-protocol.playwright.optional.test.ts` — two independent Chromium virtual authenticators register and sign in through real signature verification. `single-user-passkeys.test.ts` separately reopens a file-backed disposable store and checks labels/credentials. |
| 005 | Synced-provider behaviour is a manual device check. The server lists rows by credential ID and never claims to count physical devices. |
| 010, 011, 014, 025 | `test/web/passkey-settings.playwright.optional.test.ts` — native API cancellation, simulated prompt blur, confirmed success, lost finish response and authenticator-residue warning. OS-native prompt focus remains a manual Safari/iPad check. |
| 018 | Server tests use verifier failures and session/token binding; protocol test proves successful real attestations/assertions and rejection after removal. Existing `webauthn-user-login.test.ts` covers signed wrong-origin assertions and disabled accounts. |

All mutation tests use isolated fixtures or disposable servers. The protocol test never contacts a production origin or uses live keys. The browser fixture stubs native prompts only for UI state tests; the separate protocol test uses Chromium's virtual WebAuthn implementation and real server verification.

## Review and limits

The second read-only security review found no remaining concrete single-user authentication bypass in the inspected management paths. It noted that clients without a usable IP signal can share a coarse rate-limit bucket; this affects availability, not authentication authority.

Native macOS/iPad Safari prompts, physical security keys and cloud-synced credentials have not been tested on the owner's devices. WebKit tests establish Settings rendering and failure handling, not OS authenticator behaviour. Nothing has been merged, installed or reloaded as part of this implementation work.
