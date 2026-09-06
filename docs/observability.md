# Observability

PiClaw emits structured JSON logs and exposes a log-sink contract that any in-process add-on can use to export traces, metrics, and exceptions to external backends without modifying the runtime.

## Runtime log records

The runtime writes structured JSON log records to stdout and stderr via `createLogger()`. Every record with an `operation` field is a telemetry event; the operation name is its stable machine-readable key:

```typescript
interface LogRecord {
  ts: string;             // ISO timestamp
  level: string;          // "debug" | "info" | "warn" | "error"
  module: string;         // e.g. "agent-pool.run-orchestrator"
  message: string;        // human-readable description
  operation?: string;     // machine-readable key — the stable contract
  chatJid?: string;       // canonical actor identity for agent analytics
  turnId?: string;        // stable per-turn correlation key
  sessionLeafId?: string; // optional runtime/fork leaf identity
  userId?: string;        // browser correlation id (if supplied by web UI)
  sessionId?: string;     // browser correlation id (if supplied by web UI)
  clientId?: string;      // browser/tab correlation id (if supplied by web UI)
  [key: string]: unknown; // additional context (model, durationMs, classifier, etc.)
}
```

## Log sink API

Any code running in the piclaw process can subscribe to structured log records:

```typescript
import { addLogSink, removeLogSink, type LogSink, type LogRecord } from "piclaw/runtime/src/utils/logger.js";

const mySink: LogSink = (record: LogRecord) => {
  if (record.operation === "run_agent.complete") {
    // create a span, push a metric, etc.
  }
};

addLogSink(mySink);     // start receiving records
removeLogSink(mySink);  // stop
```

- Sinks receive every log record after it has been written to stdout/stderr.
- Sink callbacks must not throw — errors are silently swallowed.
- The `operation` field is the stable key. Match on it. Everything else is context.
- If no sink is registered, there is zero overhead beyond the normal JSON logging.

## Design properties

- The runtime does not import OTel. It logs structured records.
- Any add-on can subscribe and interpret those records as OTel spans, Datadog events, Prometheus metrics, a local SQLite store, or nothing.
- The runtime does not know what is listening, and add-ons do not need runtime code changes.
- `turnId` is the preferred join key; `chatJid` is the actor key and fallback pairing key.
- For observability, the canonical actor is the chat or agent JID, not the browser user.

## Operation reference

### Agent turn lifecycle

| Operation | Level | Key fields | Emitted when |
|---|---|---|---|
| `run_agent.prompt` | info | `chatJid`, `turnId`, `model`, `promptLength` | Agent turn starts |
| `run_agent.prompt_resolved` | info | `chatJid`, `turnId`, `promptDurationMs`, `sessionIsStreaming` | `session.prompt()` resolves |
| `run_agent.complete` | info | `chatJid`, `turnId`, `model`, `durationMs`, `outputChars`, `recoveryAttemptsUsed` | Turn finishes successfully |
| `run_agent` | error | `chatJid`, `turnId`, `model`, `durationMs`, `errorMessage` | Turn fails fatally |
| `run_agent.attempt_failed` | warn | `chatJid`, `turnId`, `errorText`, `failureCategory`, `classifier`, `recoveryStrategy` | Recovery attempt fails |
| `run_agent.no_terminal_reply` | warn | `chatJid`, `turnId`, `detail`, `hadToolActivity`, `blankTurnDelta` | Provider stopped without a reply |
| `run_agent.blank_turn_delta` | warn | `chatJid`, `turnId`, `detail`, `blankTurnDelta` | Session delta contains only user messages |
| `run_agent.recovery_compact` | info | `chatJid`, `turnId` | Compaction triggered during recovery |
| `run_agent.tool_use_budget_abort` | warn | `chatJid`, `turnId`, `assistantToolUseMessageCount`, `toolUseMessageBudget` | Tool budget exceeded |

### Model lifecycle

| Operation | Level | Key fields | Emitted when |
|---|---|---|---|
| `model.call.start` | info | `chatJid`, `turnId`, `model`, `sequence` | A provider call starts, before context conversion/auth/request dispatch |
| `model.response.start` | info | `chatJid`, `turnId`, `model`, `sequence`, `responseStartLatencyMs`, `phase?` | The provider response stream starts |
| `model.response.end` | info | `chatJid`, `turnId`, `model`, `sequence`, timing fields, `stopReason`, `usage` | A model response segment ends |

### Tool calls

| Operation | Level | Key fields | Emitted when |
|---|---|---|---|
| `tool.call.start` | info | `chatJid`, `turnId`, `toolName`, `toolCallId` | Tool execution begins |
| `tool.call.end` | info | `chatJid`, `turnId`, `toolName`, `toolCallId`, `isError`, `durationMs` | Tool execution finishes |

### Web channel

| Operation | Level | Key fields | Emitted when |
|---|---|---|---|
| `handle_agent_message` | info | `chatJid`, `mode`, `isStreaming`, `contentPreview` | User message received |
| `process_chat.select_message` | info | `chatJid`, `processingMessageId`, `pendingMessageCount` | Message selected for processing |
| `process_chat.finalize_successful_run` | info | `chatJid`, cursor state | Turn persisted and finalized |
| `process_chat.no_output_recovery_stalled` | warn | `chatJid`, `title`, `recovery` | Turn ended without output during recovery |
| `process_chat.no_output_blank_failed` | warn | `chatJid`, `hadDraft`, `recovery` | Turn produced no output at all |

### Active-turn status and preview lifecycle

The web control plane keeps the current turn recoverable through `/agent/status`. Its status payload and SSE stream use this lifecycle:

1. A turn starts in `thinking`. Thought and draft buffers are captured in full even when their panels are collapsed.
2. `tool_execution_start` creates an `active_tools` entry and changes the visible phase to `tool_execution`.
3. `tool_execution_update` advances `last_progress_at` and may add a bounded output preview. A 15-second `tool_execution_heartbeat` advances `heartbeat_at` while any tool remains active, including when watchdog escalation is disabled.
4. `tool_execution_end` records `last_completed_tool` and removes that call from `active_tools`. The phase remains `tool_execution` while another concurrent tool is active. The final tool end changes the phase to `post_tool_model` immediately.
5. A successful or failed terminal event clears current-turn previews and active-tool state.

Each active-tool snapshot includes `tool_call_id`, `tool_name`, `started_at`, `last_progress_at`, `heartbeat_at`, `status` and any bounded output preview. `active_tool_count` reports concurrent work. Heartbeats mean that the runtime still owns the tool call; they do not claim that a buffered command emitted new output.

`stalled_work` compares `lastProgressAt` with the configured progress-watchdog timeout. It reports `stalled: true` only after that age crosses the threshold. A `tool_execution` phase alone is not evidence of a stall.

After reconnect or chat activation, the client fetches `/agent/status` for the selected chat. Thought or draft events that arrive during that fetch mark the snapshot dirty. The client fetches another snapshot and repeats until one completes without a racing preview event. Turn and chat identifiers still gate every delta, so another turn or chat cannot overwrite the selected preview.

Provider event streams differ. Some providers emit no reasoning text, so the UI retains the `thinking` phase without inventing a Thoughts panel. Text emitted before a tool call is kept as the draft preview. Commands and remote tools may buffer output until completion; elapsed time and `heartbeat_at` remain the reliable liveness fields in that case.

Relevant SSE events are `agent_status`, `agent_thought`, `agent_thought_delta`, `agent_draft`, `agent_draft_delta`, `agent_done` and `agent_error`.

#### Event order and terminal authority

| Phase | Runtime evidence | Web state |
|---|---|---|
| Prompt accepted | `run_agent.prompt`; stable `turnId` and session leaf | `thinking` |
| Provider stream starts | `message_start`, then thinking or text deltas when supplied | `thinking`; thought and draft buffers update independently |
| Model requests a tool | assistant `message_end` with `stopReason: "toolUse"`; completed text is marked `followedByToolUse` | pre-tool text stays a draft or intermediate turn |
| Tool runs | `tool_execution_start`, zero or more updates and heartbeats, then `tool_execution_end` | `tool_execution`; active-tool snapshot remains recoverable |
| Model resumes | final tool end, followed by the next provider segment | `post_tool_model`, then `thinking` or drafting updates |
| Attempt ends | provider `stopReason`, resolved tool state, turn snapshots and local timeout or abort provenance | recovery policy selects a typed classifier and strategy |
| Recovery runs | `recovery_start` and `recovery_end`; any temporary tool ceiling is restored after the attempt | `recovery` intent with classifier and `failure_category` |
| Turn commits | `AgentOutput.status`, terminal turn persistence and cursor update | terminal post, then `agent_done` or `agent_error`; previews and active tools clear |

`AgentOutput.status`, `AgentOutput.failureCategory`, provider stop state, resolved tool events, attempt strategy and turn lineage decide the outcome. Assistant `result` text cannot change success, recovery strategy, tool authority or continuation state. Text completed before tool dispatch has `followedByToolUse: true` and cannot close the turn.

Protected recovery uses a `control_intent` block with intent `protected_recovery_continuation`. Its type, schema version and source/thread lineage grant authority; its label is presentation-only. `RunAgentOptions.protectedRecoveryContinuation` marks the generated ordinary continuation as one-shot. Matching the continuation prompt text or label does not grant control authority. A generic tools-disabled retry may request this handoff, but only the ordinary tool-enabled continuation or a structurally eligible `finalize` attempt may close tool-dependent work.

Terminal failures use these `failureCategory` values: `rate_limit`, `auth_config`, `network`, `aborted`, `timeout`, `tool_budget`, `context_pressure`, `output_limit`, `provider`, `no_terminal_output`, `stalled_work`, `session_corruption`, `non_recoverable`, `already_processing`, `provider_unavailable` and `unknown`. Recovery diagnostics retain the category, classifier, strategy, tool counts and context-pressure snapshot. Status and outcome-marker code consume those fields instead of reparsing titles, details or assistant output.

#### Provider and transport limits

- The provider SDK supplies `stopReason` and `errorMessage`, but it does not expose a common structured error code for every provider. At each untyped provider/SDK or injected-legacy ingress, `classifyOpaqueAgentFailure()` converts the opaque error into an enum. Recovery policy, loop suppression, persistence and status code then consume the enum without reparsing diagnostics. This compatibility classifier never reads assistant result text.
- Some providers omit reasoning deltas. The UI keeps the turn in `thinking` without creating synthetic thought text.
- Some command and remote-tool transports buffer output until completion. `started_at`, elapsed time and `heartbeat_at` show runtime ownership; they cannot prove that the remote process produced new output.
- A process crash can interrupt a tool before its terminal event. Recovered status reports the unresolved execution; the runtime does not infer completion from the last assistant message.
- Reconnect recovery returns the latest active-turn snapshot and repeats the fetch when deltas race it. It does not replay an unlimited history of prior preview deltas.
- Provider `pending` and `deferred` responses are not terminal success. A later provider event or explicit deferred fetch must supply a terminal stop.

### Session lifecycle

| Operation | Level | Key fields | Emitted when |
|---|---|---|---|
| `get_or_create.create_main_session` | info | `chatJid`, `poolSize` | New session created |
| `evict_idle.main_session` | info | `chatJid` | Idle session evicted |
| `evict_idle.side_session` | info | `chatJid` | Side session evicted |
| `memory_pressure.mode_change` | info | `rssBytes`, threshold | Memory pressure toggled |

### Compaction and rotation

| Operation | Level | Key fields | Emitted when |
|---|---|---|---|
| `maybe_auto_compact_session_before_prompt` | info | `chatJid`, `contextTokens`, `contextWindow` | Pre-prompt compaction triggered |
| `smart_compaction.source_prepared` | debug | `method`, source/event counts | Local Selective/Pipelined source prepared after any remote pre-pass fallback |
| `smart_compaction.pipeline_planned` | debug | `method`, source/group/unit counts, dispositions, coverage, audit ledger | Pipelined ledger validated |
| `smart_compaction.completed` | debug | `method`, execution, token estimates, reductions, model/chunk counts, duration | Local compaction completed |
| `smart_compaction.output_invalid` / `smart_compaction.progressive_output_invalid` | debug | `schema`, `stopReason`, `validationFailure`, retry count | Model output rejected before persistence |
| `remote_compaction.attempt` / `remote_compaction.completed` | debug/info | provider/model identifiers, counts, usage, duration | Provider-native compaction attempted/completed |
| `remote_compaction.fallback` | info | `outcome`, local method, provider/model, reason | Provider-native failure continued safely into the captured local method |
| `maybe_auto_rotate_session` | info | `chatJid`, `previousSize`, `trigger` | Session file auto-rotated |

### Dream

| Operation | Level | Key fields | Emitted when |
|---|---|---|---|
| `dream.complete` | info | `chatJid`, `mode`, `days`, `durationMs` | Dream maintenance finishes |
| `acquire_dream_lock.reap_stale` | warn | `path`, `ownerPid` | Stale Dream lock reaped |
| `run_dream_agent_turn.fallback_refresh` | warn | `chatJid`, `error`, `recovery` | Dream model pass failed |

## First-party add-on: `@rcarmo/piclaw-addon-observability`

The observability add-on uses this log-sink contract to export telemetry to Azure Application Insights and local Graphite. See the [add-on README](https://github.com/rcarmo/piclaw-addons/tree/main/addons/observability) for configuration, schema details, browser telemetry, and Kusto queries.

Ready-to-import/query artifacts in this repo:
- `docs/azure/app-insights-agent-kusto-queries.md`
- `docs/azure/app-insights-agent-observability-workbook-template.json`

### Exports

| Source | Output |
|---|---|
| `run_agent.prompt` → terminal record | `agent.turn` span |
| `model.call.start` → `model.response.end` | `model.call` child spans (`model.response.start` is an old-core fallback) |
| `tool.call.start/end` | `tool.call` child spans |
| `run_agent.attempt_failed` | `provider.error` spans + recovery metrics |
| `dream.complete` | `dream` span |
| browser SSE/fetch translation | `customEvents` keyed by `chatJid` (`agent.turn.*`, `agent.followup.*`, `agent.steer.*`, `agent.message.sent`) |
| Graphite | `agent.turn.*`, `tool.<name>.*`, `provider.error.*`, `session.*`, `dream.duration_ms` |

### Identity mapping

The first-party add-on maps identity to the chat or agent JID:

| Concept | Mapping |
|---|---|
| Primary actor | `chatJid` |
| Primary transaction | `turnId` |
| Runtime session / fork identity | `sessionLeafId` when available |
| Browser correlation | `userId`, `sessionId`, `clientId` headers from the web UI |

`chatJid` is stamped as:
- `piclaw.chat_jid`
- `piclaw.actor.kind = chat_jid`
- `piclaw.actor.id = <chatJid>`
- `enduser.id = <chatJid>` for App Insights views that expect a user field

The raw browser identifiers are still preserved separately as:
- `piclaw.browser_user_id`
- `piclaw.browser_session_id`
- `piclaw.browser_client_id`

## Writing a custom observability add-on

Any add-on can implement the same pattern:

1. `require("piclaw/runtime/src/utils/logger.js")` to get `addLogSink` / `removeLogSink`
2. Register a sink on `session_start`, remove it on `session_shutdown`
3. Match on `record.operation` to decide what to export
4. Pair turns by `turnId` first, with `chatJid` as fallback
5. Treat `chatJid` as the actor key for agent analytics
6. Use `tool.call.*` and `model.call.start` → `model.response.end` for child spans

Runtime guarantees:

- Every `run_agent.prompt` will eventually be followed by `run_agent.complete` or `run_agent` (error) for the same turn unless the process crashes.
- `tool.call.start` / `tool.call.end` pairs are emitted for every tool execution within a turn.
- `model.call.start` is emitted once per provider call, including calls resumed after tool results.
- `model.response.start` / `model.response.end` pairs are emitted for observable model segments.

### Model timing fields

`model.response.end` exposes monotonic wall-clock intervals in milliseconds:

| Field | Meaning |
|---|---|
| `callDurationMs` | `turn_start` to assistant `message_end`; includes context conversion, auth, request dispatch and provider work |
| `responseDurationMs` | Provider stream `start` to assistant `message_end` |
| `durationMs` | Compatibility alias for `responseDurationMs` |
| `responseStartLatencyMs` | `turn_start` to provider stream `start` |
| `timeToFirstOutputMs` | `turn_start` to the first non-empty thinking/text/tool-call delta, or a tool-call start |
| `timeToFirstTextMs` | `turn_start` to the first non-empty user-visible text delta |
| `generationDurationMs` | First-to-last observed thinking/text/tool-call output interval |
| `textGenerationDurationMs` | First-to-last non-empty text delta interval |

These are client-observed timings. Providers with encrypted or hidden reasoning cannot expose the timestamp of their first internally generated token, so `timeToFirstOutputMs` must not be interpreted as universal provider TTFT.
- `dream.complete` fires once per Dream maintenance pass.
- All warn/error records with an `operation` field represent actionable events.
