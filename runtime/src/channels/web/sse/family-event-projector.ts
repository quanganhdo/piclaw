import { projectFamilyAgentStatusData } from "../http/family-agent-status.js";

const allowed = new Set([
  "agent_status", "agent_thought", "agent_thought_delta", "agent_draft", "agent_draft_delta",
  "agent_preview_consumed", "agent_response", "new_post", "new_reply", "interaction_updated",
  "interaction_deleted", "agent_steer_queued", "agent_followup_queued", "agent_followup_consumed",
  "agent_followup_removed", "model_changed",
]);

const commonKeys = new Set([
  "chat_jid", "thread_id", "turn_id", "agent_id", "type", "state", "title", "detail", "status",
  "started_at", "last_event_at", "last_progress_at", "heartbeat_at", "retry_at", "model",
  "thinking_level", "thinking_level_label", "supports_thinking", "context_usage", "context_reset",
  "sessionGeneration", "recovery", "row_id", "content", "timestamp", "source", "delta", "reset", "phase",
  "intent_key", "intentKey", "kind", "mode", "estimated",
  "text", "total_lines", "totalLines", "ids", "id", "data", "agent_name", "agent_avatar",
  "user_name", "user_avatar", "user_avatar_background", "chat_agent_name",
  "tool_name", "output_preview", "output_total_lines", "output_preview_lines", "output_truncated",
  "active_tool_count", "reason", "trigger", "piclawReason", "willRetry", "aborted", "skipped",
  "targetContextWindow", "targetModelLabel", "tokensBefore", "estimatedTokensAfter",
  "estimatedTokensAfterSource", "safetyAdjustedTokensAfter", "reductionPercent", "failure_category", "classifier",
]);

function copyAllowed(record: Record<string, unknown>, keys = commonKeys): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));
}

function projectCoreBlocks(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowedBlockTypes = new Set(["agent_timing", "thinking_ref", "turn_outcome_marker", "agent_turn_marker"]);
  const blocks = value.filter(block => block && typeof block === "object" && allowedBlockTypes.has(String((block as Record<string, unknown>).type || "")));
  return blocks.length ? structuredClone(blocks) : undefined;
}

/** Per-client allowlist: no extension, widget, MCP, workspace, provider, or runtime diagnostics. */
export function projectFamilySseEvent(eventType: string, data: unknown): unknown | null {
  if (!allowed.has(eventType) || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const input = data as Record<string, unknown>;
  if (eventType === "agent_status") return copyAllowed(projectFamilyAgentStatusData(input) as Record<string, unknown>);
  if (["agent_response", "new_post", "new_reply", "interaction_updated"].includes(eventType)) {
    const projected = copyAllowed(input);
    if (input.data && typeof input.data === "object" && !Array.isArray(input.data)) {
      projected.data = copyAllowed(input.data as Record<string, unknown>, new Set([
        "type", "content", "content_meta", "agent_id", "thread_id", "media_ids", "content_blocks",
        "link_previews", "annotations", "screen_hint",
      ]));
      const blocks = projectCoreBlocks((input.data as Record<string, unknown>).content_blocks);
      if (blocks) (projected.data as Record<string, unknown>).content_blocks = blocks;
      else delete (projected.data as Record<string, unknown>).content_blocks;
    }
    return projected;
  }
  return copyAllowed(input);
}
