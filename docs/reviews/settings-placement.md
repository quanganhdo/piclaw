# Core Settings placement

TOTP now lives in Authentication, widget-token controls in a small API access page, and automatic recovery in Sessions. Authentication and Sessions keep their names and IDs. General retains identity, notifications, display and upload controls. Other core pages, provider credentials, Keychain and add-on configuration are unchanged.

## Behaviour

- Classic moves existing TOTP setup details beside the shared passkey component. Visual removes the duplicate General status and displays the configured setup details in Authentication.
- Visual previously offered TOTP enable/disable buttons that submitted `general.totp`, a field the backend ignores. Those buttons are removed. Both skins point to the existing `/totp enrol` and `/totp reset <current code>` confirmation flows; no authentication backend or policy was added.
- Both API access pages use the existing widget-token regeneration endpoint. Reveal/copy, confirmation, cancellation, rejected requests and saved-token propagation are covered.
- Classic removes recovery fields from General's autosave snapshot and adds them to Sessions. Visual adds the same recovery fields to Sessions, using existing field-level saves and millisecond units.
- Visual keys the pane renderer by section ID so hooks and local form state do not carry over when switching pages. An optional settings-merge callback propagates regenerated tokens into the existing Settings snapshot.
- The moved Visual forms use scoped phone-width stacking rules. The initial browser run found a 12-pixel overflow in the new Authentication metadata rows; the final run verifies Authentication, Sessions and API access at 390 and 1024 pixels.

## Evidence

Base: `78af3d06b` (v3.2.3). Work ran in `/workspace/piclaw-worktrees/settings-placement` on Smith, through the repository's isolated test launcher and niceness-10 full gate. Browser tests serve shipped Classic/Visual bundles from an ephemeral loopback server and intercept API requests. No live settings, secrets or credentials were changed.

| Check | Result |
| --- | --- |
| `make ci-fast` | 5,677 runtime passes, 7 skips, 0 failures; 25 feature checks; 9 build tests |
| Post-build Settings-placement and existing passkey shell suites | 12 passes, 252 assertions; Chromium/WebKit, Classic/Visual, phone/desktop |
| Focused placement, General, autosave, save-state, handler and passkey tests | 44 passes, 203 assertions |
| `bun run typecheck` | Runtime, scripts, Settings and web-pane projects passed |
| Scoped Oxlint, stale-dist, pack hygiene, diff check | Passed |
| Delegated source review | No blockers found |

The browser suite checks placement, General save isolation, recovery persistence and rejected saves, section return values, token reveal/copy, rotation confirmation/cancellation/failure, returned-token persistence, passkey rename and last-factor removal protection. Existing passkey-shell coverage also exercises Settings without a configured TOTP payload.

Earlier full-gate runs caught an outdated exact CSS-selector assertion and missing acceptance-scenario IDs. Both were corrected before the complete green run. Logs are retained under `/workspace/tmp/settings-placement-*`, including `ci-green.log`, `browser-postbuild.log`, `unit.log` and `static-final.log`.

## Limits

The separate full Visual strict TypeScript project is not green on the base checkout. Running it with Bun types produced 77 diagnostic lines for this branch versus 78 for the base; the only difference is removal of the old TOTP dialog's invalid `message` property. It added no diagnostics. The repository's four supported typecheck projects pass.

Browser tests simulate API responses and do not establish physical authenticator or native iOS behaviour. The existing shared-passkey JSX pragma warning still appears during builds. No install, merge or restart was performed as part of this implementation.
