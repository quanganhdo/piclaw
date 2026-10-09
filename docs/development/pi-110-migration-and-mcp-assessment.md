# Pi 1.1.0 migration and MCP assessment

Pi 1.1.0 supports the current Piclaw integration with the shipped MCP adapter retained. Native replacement is not qualified.

## Release and package admission

Target: [Pi v1.1.0](https://github.com/earendil-works/pi/releases/tag/v1.1.0), `abe508e1b89912adde45528136c3221eb69acdd7`, published 7 October 2026. All eight family packages use exact 1.1.0 pins and lockfile integrity.

The npm manifests omit `gitHead`. Admission allows that omission only for this exact release; a conflicting value rejects. Hard-coded SHA-1/SHA-512 archive identities, the eight-package set, versions, URLs, exports, engines and installed-versus-extracted package payloads are checked. The tag SHA is caller-supplied release metadata. These checks establish published archive identity; they do not establish independently reproduced source-to-build provenance. Provider inventory bytes are separately SHA-256 pinned.

The active 1.0.4 tests are retargeted to executable 1.1.0 fixtures. Historical 1.0.4 receipts and fixture source remain available; their results are not relabelled. Pi-durable, Harness/Pico3 and Native activation are excluded.

## MCP changes since 1.0.4

| Change | Scope and consequence |
|---|---|
| OAuth discovery, registration and token requests accept abort signals | Public `pi-mcp` flow API. Cancellation now reaches those fetches. The flow accepts an explicit signal; it does not impose a universal timeout itself. |
| Native login bounds the whole sign-in and each authorization request | Upstream CLI/native bridge provides the deadline and shutdown cancellation; release notes specify 15-second request timeouts. Piclaw's adapter has its own owner and deadlines. |
| Streamable HTTP close uses the last request token | Native transport no longer invokes token refresh just to delete a closing session; best-effort DELETE has a one-second timeout. This does not prove every server closes successfully. |
| Native `/mcp` manager updates while connections settle | Upstream terminal UX improvement. Piclaw web Settings uses its own adapter control surface. |
| Codemode separates multiple text output items and console output | Public codemode result format changes: `==> text N/M <==` delimiters and `<console_output>` blocks. Consumers must preserve content without assuming old concatenation. |
| Additive/subtractive `--tools` entries | Public CLI `+name`/`-name` modifies defaults; plain selections retain replacement semantics, and mixed forms reject. Existing child MCP-none and tool-exposure tests retain explicit selection. |

Upstream adds `agent_settled.aborted`, tool `durationMs`, classifier images and new models. Current integration gates pass without adopting new accounting, routing or approval policy. Model catalogue availability never grants Delegate/provider approval.

## Retained adapter versus Native

The shipped adapter stays the sole MCP owner. Existing settings, keychain/config-generation, exclusions, reload, lifecycle and session policy remain in force. Synthetic current/new-session tests execute the actual public script and nested tool pipeline with hidden-tool denial, parent IDs, zero unintended network attempts, preserved history and transport-close checks. Public OAuth registration tests distinguish native loopback/custom-scheme redirects from HTTPS web redirects.

The 1.1.0 compile probe still reports the same ten unavailable integration seams:

- `lazy`
- `statusObserver`
- `resourceFilter`
- `authStart`
- `appRenderer`
- `absoluteDeadlineMs`
- `McpOAuthCredentialStore`
- `socket`
- `listPrompts`
- `getPrompt`

These are rejected by exact typed negative probes. The positive public contract compiles. A compile result does not certify runtime parity. Piclaw-specific credential ownership, resource/prompt filtering, status, interactive auth/app rendering and deadline contracts still prevent a blanket adapter replacement. Native teardown-failure probes expose imperfect close acknowledgement; no raw provider settlement or filesystem sandbox is inferred from `agent_settled` or process groups.

## Qualification

- Eight registry archives verified and installed package payloads compared with extracted archives.
- Full local `ci-fast`: 6,690 passed, 74 historical/opt-in skips, zero failures; 25 feature and nine build checks passed. Earlier failed runs are retained under `reviews/pi-110-assessment/`.
- Published CLI bundle: 77 JavaScript files; ten actual OpenAI/OpenAI Codex login cases in disposable profiles, loopback-only namespaces, dropped capabilities and no inference. PKCE/state, denial, cancellation, provider-only rejection and clean editor quit verified.
- Public Copilot/Kimi device matrix, Codex device matrix, Anthropic/OpenRouter browser/copy-code matrix and refreshed inventory use exact installed implementations.
- Anthropic private UI: ten Chromium/WebKit cases, 1,342 assertions, cancellation/privacy/recording checks; `PI_OFFLINE=1` required to prevent catalogue refresh on login/activation. Earlier fixture invocation and missing-offline failures retained.
- Shipping plain Delegate executes the actual Pi 1.1.0 CLI with inherited thinking, JSON/no-session and cleanup under synthetic provider replies.
- Negative admission rejects conflicting registry gitHead, altered integrity, duplicate/wrong-version packages and changed provider receipts.

Receipts: `docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-110-*.json`. Private disposable profile directories and raw logs are not public artifacts.

## Operational limits and next MCP work

This migration changes source pins and qualification only. No live installation, restart, account login/logout/refresh, MCP server operation, inference spend or experimental activation was performed.

Keep the adapter for this release. Treat native OAuth and teardown improvements as upstream capabilities to evaluate through separate runtime tests before adopting them. Finish the supported-wrapper/child exposure matrix and separately approved real-server/provider checks under #1455, #1458 and add-ons #160. A future Native migration needs explicit ownership, credential, resource/prompt, UI/deadline and close-failure acceptance; the 1.1.0 update supplies no waiver.
