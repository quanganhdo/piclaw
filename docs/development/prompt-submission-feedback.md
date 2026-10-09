# Feedback while submitting a prompt

Both skins show a local status row as soon as a prompt is submitted. It displays “Sending message…” until the HTTP response confirms acceptance, then “Message accepted. Waiting for agent…” until matching run feedback arrives.

The row does not claim that an unacknowledged prompt is stored or that model inference has begun. Queued, command, UI-only and successfully relayed submissions clear it at acknowledgement; their existing responses and queue displays own subsequent feedback. Failed sends clear the row and retain existing draft/error behaviour. Attachment progress remains separate.

## Event ordering

`SubmissionFeedback` owns presentation state only. Each send has a generation, captured chat and acknowledgement identities. A changed chat or unmount invalidates earlier callbacks. Older acknowledgements, errors and finally blocks cannot overwrite a later send. Status from another chat or an earlier thread cannot dismiss the current cue.

The ordinary HTTP response carries a row-based thread ID, while process-chat lifecycle status uses the selected source message timestamp. Both identities from the accepted response are recorded. Up to sixteen status identities can be held before acknowledgement, allowing an early matching event to prevent the waiting row from reappearing.

Classic publishes matched run/terminal status from live SSE, status polling and reconnect recovery. Visual consumes its live status event and the shared polling event, and resets on current-chat navigation. Retained terminal `done`/`error` payloads clear matching feedback even when SSE was missed. An idle-only snapshot without a matching terminal identity does not fabricate completion.

## Findings and limits

The backend already publishes initial “Thinking…” before the optional model metadata lookup and session hydration in `createProcessChatStreamingRuntime`. The existing blocked-metadata test verifies this ordering. Earlier message admission, pending-message selection and prompt preparation can still delay that stage.

Previously, admission was represented mainly by a disabled Send button and changed tooltip/ARIA label. Acceptance could leave the UI without a visible activity cue until startup status arrived. Held-response and withheld-startup browser fixtures reproduce this visibility gap and verify the new status row.

No live probe prompts or provider calls were made. This change makes the wait visible; it does not establish hydration as the cause of every reported delay or claim to reduce backend startup time. Synchronous server stalls can still delay receipt of the response/status, while the local sending cue is already visible.

## Checks

- Shared state tests: acknowledgement truth, status-before-ack, stale chat/thread, timestamp identity, queued/command paths, failure/interception, and obsolete generations.
- Real status-controller tests: active/terminal polling and reconnect recovery, including terminal-before-ack and uncertain idle snapshots.
- Shipped Classic/Visual entrypoints on Chromium/WebKit: held POST feedback before any durable row, accepted waiting state, old-status rejection, matched startup handoff, status-before-ack, event/ACK deduplication, queue ACK and rejected submission.
- Full qualification and source review are recorded in `docs/reviews/prompt-submission-feedback.md`.

No backend admission authority, database commit, queue execution, model selection or provider credential policy changes. Installation and restart require separate approval.
