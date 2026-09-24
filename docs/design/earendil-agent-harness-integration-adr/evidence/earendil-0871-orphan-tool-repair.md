# Earendil 0.87.1 orphan tool-result repair (#1380)

Piclaw now repairs orphaned tool results in the session manager's projected context. Earendil 0.87.1 rebuilds agent messages from that projection before a request, so changing only `agent.state.messages` cannot remove an orphan from the next provider payload.

## Repair boundary

Before an ordinary prompt and before manual `/compact`, Piclaw reads the manager's active, compaction-aware projection and collects tool-call IDs. A result without a matching call must map to one editable source message or custom message. Piclaw validates all mappings before writing. It appends a context edit that omits a standalone orphan result or removes only orphan blocks from the mapped content array. It then checks the projection again. The original JSONL messages remain as audit entries; the edits are appended to the same session file. A second check sees the projected repair and makes no further edits.

Linked results, suffixed/encrypted call IDs and non-tool blocks are retained. An ambiguous or unmappable result, unavailable projection, unsupported append operation or failed projection check stops the prompt/compaction rather than reporting success. Piclaw no longer assigns repaired messages to `session.agent.state.messages`.

## Pinned runtime and rollback

The installed 0.85.1 manager has no `appendContextEdit`. If it encounters an orphan in canonical session context, Piclaw fails closed; this compatibility slice cannot perform a durable repair until the coordinated 0.87.1 upgrade in #1381. A mutable agent array without persisted entries is not evidence of a repair. If this blocks a turn before #1381, use a fresh or rotated session after inspecting the affected JSONL; do not override the guard by editing private manager indexes.

Context edits written by 0.87.1 survive a session reopen and leave raw tool-result entries intact. Before that upgrade, take a verified snapshot of session JSONL and Piclaw state. A rollback to 0.85.1 must restore the pre-upgrade snapshot: that older manager ignores context edits and would reconstruct the orphaned provider context. No automatic JSONL downgrade or live provider test is part of this slice. A disposable 0.87.1 `SessionManager` test verified append, restart and raw-entry preservation; pinned-runtime tests cover detection, fail-closed behaviour, exact mapping, idempotence and both call sites.

The 0.87.0 candidate manifest is historical evidence and was not changed.
