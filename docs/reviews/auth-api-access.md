# Authentication API access and Settings order

Authentication now contains the existing API access controls beneath TOTP and passkeys. There is no separate API access sidebar entry. Token endpoints, confirmation, copy/reveal and persistence behaviour are unchanged; Keychain and provider authentication remain separate.

## Navigation

- Appearance immediately follows General in both skins.
- Tools immediately follows Models in both skins.
- Keychain immediately follows Environment in both skins.
- Classic Quick Actions immediately follows Keyboard. Visual has no Quick Actions Settings pane; this change does not add one.
- Authentication and Sessions keep their labels and IDs.
- Old `api-access` open events resolve to `authentication`, whether Settings is already mounted or not. Visual also migrates an old saved category and normalises the app-level event before persistence.

Classic embeds the existing API component with its settings/status/merge callbacks. Visual renders the existing token component inside Authentication and removes its pane registration. No backend changes or new settings fields.

## Validation

Base: `87ed12d82` (merged #1410). Isolated worktree: `/workspace/piclaw-worktrees/auth-api-access`.

| Check | Result |
| --- | --- |
| Final `make ci-fast` | 5,678 runtime passes, 7 skips, 0 failures; 25 feature checks; 9 build tests |
| Post-build actual-shell Settings/passkey tests | 12 passes, 308 assertions; Classic/Visual, Chromium/WebKit, 390/1024px |
| Focused placement, General and control tests | 13 passes, 100 assertions |
| Four repository typecheck projects | Passed |
| Scoped Oxlint, stale-dist, pack hygiene, diff check | Passed |
| Delegated source review | Initial persistence finding fixed; follow-up found no blocker |

The browser tests exercise the combined page, absence of a separate sidebar entry, all requested relative orders, old links and saved selections, token copy/cancel/rotation/error/persistence, passkey rename and last-factor removal protection, recovery saves, and phone-width layouts. Tests serve compiled entrypoints from a disposable loopback fixture with intercepted APIs; they do not mutate live settings or credentials.

Earlier browser failures exposed the Classic mounted-dialog alias path and test assertions that did not wait for asynchronous passkey loading. A navigation button outside the accessibility viewport also needed a text-based locator. All final cases pass.

The separate full Visual strict TypeScript project still fails on existing baseline diagnostics; comparison with the #1410 result is unchanged except for a line-number shift in `App.tsx`. The repository's four typecheck projects pass. Desktop WebKit does not establish native iOS behaviour.

Logs: `/workspace/tmp/auth-api-access-ci-final.log`, `auth-api-access-browser-postbuild.log`, `auth-api-access-focused-final.log`, `auth-api-access-static-final.log`, `auth-api-access-hygiene.log`.

No merge, installation or restart was performed for this follow-up.
