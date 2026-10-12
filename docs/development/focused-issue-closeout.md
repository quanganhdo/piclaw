# Dictation, keychain and command follow-through

The follow-through fixes the verified empty-draft dictation Send, cancellation/status races, disabled-keychain visibility and session-backed command eviction gaps. The Plan tool's repeated branch-session failure remains unconfirmed; same-batch activation/use is an SDK limitation, now stated explicitly in the activation guidance.

## Dictation #1620

Send can create its finish barrier while capture is active before the first partial. Intentional cancellation stays cancelled/idle. Provider loading/recording callbacks cannot override finishing. Regression tests cover held start/finish deadlines and late cleanup, and the actual mic/Send path in both skins and browser engines.

`runtime/public/addon-hooks.d.ts` ships self-contained consumer types. An isolated test packs the actual package, extracts it to a consumer's node_modules, and compiles the documented `piclaw/runtime/public/addon-hooks` import. A separate compiler invocation enforces bidirectional parity with core types. The connected example documents opt-in, ordered audio, final-drain and disposal without composer DOM interception.

## Keychain #1621

The authenticated settings endpoint returns storage availability without material or paths. Missing/unreadable bootstrap material disables Add in both skins and presents setup guidance. Failed web writes log operation/reason only. Tests verify no posted entry name, secret or note reaches that log and both real settings components show disabled state. Existing error responses and external-provider listing remain compatible.

## Commands #1559

Session-backed control and extension slash commands hold manager eviction protection from lookup through handler/refresh completion, including failures. Real manager regressions exercise TTL and pool cap pressure, post-completion eviction and failure release. UI-only `/theme` does not hydrate a session; `hasCommand` now includes theme commands and `response_delivery` distinguishes applied theme state from failed timeline persistence. These fixes address verified lifecycle/diagnostic gaps, not proof that eviction caused the original `/theme` report.

## Plan #193

Real SDK tests verify inactive-tool activation succeeds for use on the next model step. Activation/use in the same assistant batch retains the SDK's original missing-tool result; the immutable executable snapshot precedes activation. Guidance requires waiting for activation and never batching it with use. No fallback calls a registered handler directly or bypasses allowlists. Earlier actual add-on tests likewise passed on the next step. Repeated failure in later branch-session calls still requires an affected-profile reproduction; retain the issue.

No live installation, restart, recogniser download, inference or credential changes. #1626 is separately qualified in PR #1629. Full and browser receipts must be attached to the published candidate; a merged implementation alone does not establish all historical acceptance tests.
