# Agent message classification

Assistant output has two separate properties: its output role and whether it is the terminal persisted response of a run. Cleanup must use positive classification evidence; a zero terminal flag does not identify disposable commentary.

## Stored contract

New host-classified agent output carries this block in `messages.content_blocks`:

```json
{
  "type": "agent_message_role",
  "version": 1,
  "role": "final",
  "terminal": false
}
```

`role` is `final`, `intermediate` or `unknown`:

| Evidence | Role | Terminal flag |
|---|---|---|
| Provider explicitly emits `final_answer`, then starts another response or tool call | `final` | `0` |
| Provider explicitly emits `commentary` at a valid persisted boundary | `intermediate` | `0` |
| No reliable provider phase, interrupted final-answer draft, or contradictory boundary metadata | `unknown` | `0` |
| Runtime stores its final response or terminal outcome marker | `final` | `1` |
| Successful run has no additional output and its latest captured completed response is eligible for promotion | `final` | `1`, updated on that exact row |

The existing `messages.is_terminal_agent_reply` column remains the run-terminal flag. A positive bit protects older final replies. Its zero/default value includes intermediate messages, old finals, notifications, scheduled output and other writers; these are not automatically intermediate.

Timeline/API interaction data exposes `agent_message_role` and `is_terminal_agent_reply` for assistant rows. User rows have neither derived field. Family SSE projection retains both fields and the host role block.

## Boundaries and promotion

The turn coordinator preserves `textPhase` from provider text signatures and its existing completed-response evidence. A completed provider response is not automatically run-terminal: the boundary callback occurs when another stream starts.

Web persistence always stores boundary callbacks as nonterminal. The handler records an eligible completed response's exact row ID, replaces that candidate on each later callback, and promotes it only after a successful run with no new final output. Error and tool-complete paths do not perform this promotion. A later final/error response leaves the earlier row nonterminal.

Promotion uses an immediate transaction scoped to chat and row ID. It requires an assistant row, false terminal bit, one valid version-1 `final`/`unknown` role block and a completed-boundary marker without tool continuation. It does not change text, media or unrelated rows. The updated interaction is broadcast after promotion.

This fixes the old path that persisted a completed final response through the intermediate callback, then treated an empty trailing result as success without tagging the existing row.

## Trust and historical data

Role blocks are server-owned. Browser/model content-block sanitizers remove them; service-effect block validation rejects them. `storeAgentTurn` removes supplied role blocks before generating its own. Missing, duplicate, malformed, future-version or terminal-mismatched tags resolve to `unknown`. A positive existing terminal bit resolves to `final`.

There is no schema migration, historical backfill, deletion or live configuration change. Old `agent_turn_marker` blocks describe persistence boundaries but cannot recover the lost provider text phase. Neither timing metadata nor message prose is sufficient to reclassify them.

For a future cleanup, select explicit `intermediate` role blocks on assistant rows with a false terminal bit. Preserve `final`, `unknown`, user rows and messages with attachments or required thread/queue relationships. Generate a dry-run report before deleting anything. This change does not implement retention or deletion.

Thinking persistence is separate: model-emitted thinking is stored in `thinking_content` with `thinking_ref` links. Visible progress commentary is ordinary assistant message text with the classification above.
