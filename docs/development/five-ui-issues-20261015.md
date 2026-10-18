# UI lifecycle and widget isolation qualification

Base: 511c6f7f6. No deployment or restart is included.

## Changes

- #1545: generated widgets use opaque sandbox origins. Both host bridges require the actual iframe sender, including messages carrying a known widget key. Child bridges require the parent sender. Narrow public vendor-module/font CORS supports opaque-frame imports without credentials; application/API/workspace responses remain outside that allowance.
- #1551: connection generation changes synchronously and fences status polling, including disconnect/reconnect ABA and coalesced requests. Disconnected polling cannot restore draft/thought/status previews.
- #1531: use existing terminal-return machinery on Safari as well as other browsers. Validate origin, source window and pane identity before reattachment; recover the original terminal tab without introducing another UI surface.
- #1527: stat fallback reloads clean editor contents while preserving dirty drafts. Async completion rechecks file/view identity, modification time, disposal and intervening edits; preserve selection/focus and existing conflict handling.
- #1522: current-main held-compaction success/error/cancel cases already pass. Add regression coverage; no newly reproduced compaction defect or backend fix is claimed. Retain the issue pending affected-case evidence.

## Verification

- Full local gate: 6,928 pass, 74 baseline skips, zero failures; feature/build phases 25 and 9 pass.
- Widget browser suites: 22 pass, 134 assertions. Eight Chromium dual-skin runtime/security cases plus fourteen Chromium/WebKit state cases; not twenty-two WebKit security cases. Opaque frames load actual vendored Three/Mermaid, WASM and CSS, cannot access parent DOM/storage, reject forged/retired senders, and do not obtain credentialed CORS access.
- Final status/editor/terminal browser batch: 22 pass, 94 assertions, including actual WebKit editor/terminal tests. Additional status WebKit cases are recorded separately; overlapping batches are not additive independent coverage.
- Runtime TypeScript and diff checks pass. Independent source judge found no actionable blocker; exact-head hosted and final review receipts belong with the PR.

Browser fixtures use disposable ephemeral servers and production lifecycle/SSE handlers. The status fixture is not a real EventSource transport; its Stop control is not the full Compose/context-meter UI. Manual compaction backend tests exercise production command/status/abort paths with held requests. No provider inference, production settings or user files were used.
