---
name: token-chart
description: Generate a 7-day token usage chart (all chats) and post it to the web UI timeline.
distribution: public
---

# Token chart

Generate token-usage charts from the database or from session files.

## Modes

- `default` — daily stacked token-usage bars across the last N days
- `provider-model` — stacked usage grouped by provider + model for attribution by model family
- `provider-model-cost` — estimated cost grouped by provider + model using the pricing reference bundled with the script

## Examples

Default chart:

```bash
bun /workspace/piclaw/runtime/skills/operator/token-chart/token-chart.ts
```

Provider + model chart:

```bash
bun /workspace/piclaw/runtime/skills/operator/token-chart/token-chart.ts --mode provider-model
```

Estimated provider + model cost chart:

```bash
bun /workspace/piclaw/runtime/skills/operator/token-chart/token-chart.ts --mode provider-model-cost
```

Post to the web chat via IPC:

```bash
bun /workspace/piclaw/runtime/skills/operator/token-chart/token-chart.ts --ipc
```

Post via IPC and allow a Pushover nudge:

```bash
bun /workspace/piclaw/runtime/skills/operator/token-chart/token-chart.ts --ipc --nudge
```

## Data sources

- default source: `token_usage` rows in `${PICLAW_STORE}/messages.db`
- `--source sessions`: read usage from session files under `${PICLAW_DATA}/sessions` instead of SQLite
- `--sessions-dir <dir>`: override the session-file location explicitly

Use `--source sessions` when DB-backed token usage is unavailable or when you want to inspect raw session-file history directly.

## Output behaviour

- `--ipc` writes an IPC message JSON file and, if needed, an SVG media file so piclaw posts the chart to the web timeline.
- without `--ipc`, the script writes markdown to stdout with an embedded SVG data URL plus summary text.
- `--output-svg <path>` writes the SVG to a file in either mode.

## Notes

- Numbers are formatted with compact `K` / `M` labels.
- The estimated cost mode uses `provider-model-pricing-reference.ts`, the route-specific `pricing-2026-09-05.json` snapshot, and the human-readable note `provider-model-pricing-reference.md`.
- This chart resolver estimates base-tier API value. Request-level long-context tiers, subscription allowances and actual invoices require separate analysis.
- Use this on demand unless you intentionally wire it into a scheduled task.
