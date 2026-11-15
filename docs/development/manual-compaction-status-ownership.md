# Manual compaction status ownership

Historical #1522 implementation receipt. The legacy compaction/rotation handlers described below are retired under #1673. Current execution uses captured native controls and SDK maintenance; see [prompt-owner retirement](native-prompt-retirement.md). This receipt does not certify the current native lifecycle.

Issue #1522: the compaction indicator and Stop control could disappear while compaction was still running.

## Reproduction and fix

A held `/stats` command starts first. Manual compaction then publishes a newer intent. When the older command finishes, its terminal status used to replace the newer compaction status. The UI rejects that foreign-turn SSE terminal, but a subsequent status poll sees idle and removes the controls.

Command status publication now claims a turn on its first emission and requires that turn to retain ownership for subsequent progress and terminal updates. An older command still delivers its response but cannot replace a successor or resurrect cleared status. Context-usage events remain published and persisted without replacing lifecycle status.

Compaction and session rotation claim their intent before asynchronous model lookup. Metadata updates retain the original turn/start time and use the same ownership check. Failed lookup is nonfatal. This closes the delayed-first-emission ordering found during independent review.

## Verification

Production Compose context-meter controls and message-response callbacks run against a disposable backend using production command/status/abort handlers. Held success, error and cancellation cases exercise the actual Stop control. The late-command case failed on baseline and passes in Chromium and WebKit, eight cases and 126 assertions per engine. These are fixture-backed tests, not live provider inference or proof of the original report's exact event sequence.

Backend regressions cover late success/error/rejection, newer command or LLM ownership, missing/expired status, context usage, and delayed/failed model lookup. Runtime types and the full local CI gate pass; independent source review cleared the corrected ownership ordering. Final hosted receipts belong with the PR.

No deployment, restart or production state changes are included.
