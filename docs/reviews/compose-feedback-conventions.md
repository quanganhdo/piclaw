# Restore compose feedback conventions

Accepted input belongs to the timeline or existing follow-up queue. This correction removes the post-acceptance waiting strip and both added queued acknowledgement notices. Pending HTTP submission uses each skin's existing status/spinner classes, then clears at acknowledgement or error. Direct browser steering requests the existing persisted-steering path, so accepted injected input appears once in the timeline.

## Qualification

Frozen source `52f769458d1328498023d1143f5ffad3947dd74c`, tree `cb2fbc2c08378785cfd8317d6b386db210cd38fe`, runtime tree `42e65663862c28ef3e77076319e8719ca0532778`.

| Gate | Result |
| --- | --- |
| Complete runtime suite | 6,716 passed / 74 skipped / 0 failed; 43,660 assertions; 968 files; 673.66s |
| Focused feedback, steering, admission and finalization | 112 passed / 560 assertions; 10 files |
| Rebuilt shipped Classic/Visual Chromium/WebKit | 4 passed / 164 assertions |
| Settings/pane contracts | 25 passed / 253 assertions |
| Web build | 9 passed / 26 assertions |
| Types, scoped lint and static policy | Passed; 94 unchanged transitive frontend diagnostics |
| Explicit 6.1 follow-up source review | Scoped CLEAR after removing duplicate fallback path; no reviewer tests |

Complete gate ran 10 October 2026 10:23:15–10:34:38 UTC with unchanged clean head/tree. Wrapper log SHA-256 `679e940162af9bce154f434ab43f33819a8a0cc7c0cd696aa5befacbeb2e9021`. Private exact-source canonicalci-fast receipt `ed1ba400-7704-4eb1-8f05-504c5d739418` passed; aggregate 6,750 passed / 74 skipped / 0 failed across three subprocess summaries. Raw log hash `2bfcef12a3de12ada6969493e141a2f0d1726c41e04337c7c9b9c281034ad0cd`. Other receipt capabilities are not-run; browser evidence is separate.

## Changed behaviour and safety

- Sending is transient HTTP state only. The waiting state, bounded thread-correlation cache, status-event bridge and polling/reconnect publication hooks are deleted. Native agent status owns ongoing work.
- Custom feedback CSS is removed. Classic uses `agent-status` / `agent-status-spinner`; Visual uses `agent-status-panel__status` / `agent-status-panel__spinner`. Existing error and attachment progress presentations remain.
- The two clients set `persist_steer: true`. The existing server path stores and broadcasts accepted steering and returns the same user message for HTTP/SSE deduplication. Successfully injected steering is marked and excluded from ordinary replay.
- Active-but-not-streaming startup still admits a durable follow-up before inserting an ordinary row. Its existing queue card provides feedback; no added notice is shown.
- A persisted request that cannot inject after a stream ends retains only its accepted ordinary row in the serialized chat lane. Finalization resumes that row before deferred materialization. Tests run finalization, selection and cursor advancement and assert one row, one wake and no deferred copy.
- Positive-acknowledgement validation, generation fencing, error draft restoration and newer-draft preservation remain intact.

The previous waiting correlation read a nested timestamp, while the real interaction's timestamp is top-level; mock events masked that mismatch. Rather than expanding correlation heuristics, the redundant post-acceptance feedback system was removed. The browser fixture now uses the real top-level timestamp shape and verifies no waiting/queued notices, native pending styles and one steered timeline row in both skins and engines.

Review rejected an initially added persisted-row follow-up fallback because it could deliver through both ordinary and deferred paths. That branch was removed, and the complete finalization path is now tested. Initial failure evidence is retained under `/workspace/exports/compose-conventions-*`. Tests specific to the removed correlation system were replaced with transient-state/generation tests; ordinary status and draft protections remain tested. No deadlines were increased. Import-related type-baseline coordinates were updated without omitting diagnostics. One pre-existing useless initial assignment in the changed API file was removed to pass lint.

Publication after qualification changes docs/receipts only with runtime parity verified. No live prompt, provider, production configuration, installation or restart changes. Merge requires separate approval.
