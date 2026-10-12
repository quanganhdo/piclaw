# Compose feedback follows native status and timeline conventions

While the message POST is pending, both skins show “Sending…” using their existing agent-status row and spinner classes. The local status ends when acceptance is acknowledged or an error occurs. It does not continue into a post-acceptance waiting phase.

After acceptance, the timeline, existing follow-up queue and authoritative agent status own feedback. There are no separate “Message accepted. Waiting for agent…”, “Steering queued for the current turn.” or “Follow-up queued.” notices. Attachment upload and submission errors retain their existing presentations.

## Timeline steering

Keyboard/button steering in the browser requests the existing persisted-steering path with `persist_steer: true`. Successfully injected steering is stored as a user message and marked as steering, so it appears directly in the timeline without ordinary replay. Both the HTTP acknowledgement and SSE can carry the same row; normal timeline deduplication handles either order.

If the turn is starting but cannot accept a stream yet, input uses the existing durable follow-up queue and its queue card. Fresh activity is checked again during admission. If a persisted request reaches an ended stream, its accepted row remains the single ordinary delivery path in the serialized chat lane. It does not also create a deferred copy. Successful run finalization resumes remaining persisted input before draining deferred items.

## Draft safety

The composers retain the positive-acknowledgement guard: a successful HTTP status with malformed, empty or rejected data does not silently consume the draft. New text entered during a pending submission remains available. A committed relay-source receipt prevents encouraging a duplicate-source retry. No uncertain submission is retried automatically.

The local feedback controller needs only a request generation to reject stale acknowledgement/finally/error callbacks after navigation or a newer send. It no longer tracks thread identities or listens to run-status events.

## Why the old indication persisted

The previous implementation created a separate post-acceptance waiting strip and tried to correlate it with agent status. Its acknowledgement call read a message timestamp from `user_message.data.timestamp`, but the backend interaction stores `timestamp` at the top level. Lifecycle status used the timestamp while the fallback ACK identity used the numeric row ID; this could leave the new strip visible beside actual work. Maintaining another activity display also departed from the existing UX conventions. The correlation machinery and post-acceptance strip have been removed instead of adding another heuristic.

The backend already emits initial Thinking before optional metadata/session hydration. This correction does not claim to diagnose every startup delay. No live prompts, provider accounts, production configuration, installation or restart are changed.
