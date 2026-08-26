// Shared helper/utility functions for message-list modules

import type { ContentBlock, Interaction } from "./types";
import { formatRelativeTime } from "../../utils/format";

export function relativeTime(isoDate: string): string {
  return formatRelativeTime(isoDate);
}

export function getBlockKey(block: ContentBlock, index: number): string {
  return block.id ?? `block-${index}`;
}

const PROTECTED_RECOVERY_REASONS = new Set([
  "post_compaction_tools_required",
  "tools_required",
  "compaction_failed",
  "recovery_budget_exhausted",
  "unresolved_tool_execution",
  "continuation_generation_exhausted",
  "provider_retry_exhausted",
]);
const PROTECTED_RECOVERY_TYPED_KEYS = [
  "reason",
  "compaction",
  "tools_required",
  "retryable",
  "recovery_attempts",
] as const;

function hasValidProtectedRecoveryHandoffFields(block: ContentBlock): boolean {
  const record = block as Record<string, unknown>;
  const hasTypedFields = PROTECTED_RECOVERY_TYPED_KEYS.some((key) => Object.hasOwn(record, key));
  if (!hasTypedFields) return true;
  const valid = PROTECTED_RECOVERY_REASONS.has(String(block.reason))
    && (block.compaction === "not_attempted" || block.compaction === "succeeded" || block.compaction === "failed")
    && typeof block.tools_required === "boolean"
    && typeof block.retryable === "boolean"
    && Number.isInteger(block.recovery_attempts)
    && Number(block.recovery_attempts) >= 0;
  if (!valid) return false;
  if (block.reason === "post_compaction_tools_required") {
    return block.compaction === "succeeded" && block.tools_required === true;
  }
  if (block.reason === "compaction_failed") return block.compaction === "failed";
  if (block.reason === "tools_required" || block.reason === "unresolved_tool_execution") {
    return block.tools_required === true;
  }
  return true;
}

export function getProtectedRecoveryControlIntent(
  blocks: ContentBlock[] | undefined,
): ContentBlock | null {
  if (!Array.isArray(blocks)) return null;
  return blocks.find((block) => (
    Boolean(block)
    && typeof block === "object"
    && block.type === "control_intent"
    && block.intent === "protected_recovery_continuation"
    && block.schema_version === 1
    && typeof block.source_message_id === "string"
    && block.source_message_id.trim().length > 0
    && Number.isInteger(block.source_row_id)
    && Number(block.source_row_id) > 0
    && Number.isInteger(block.thread_id)
    && Number(block.thread_id) > 0
    && Number.isInteger(block.handoff_depth ?? 1)
    && Number(block.handoff_depth ?? 1) > 0
    && hasValidProtectedRecoveryHandoffFields(block)
  )) ?? null;
}

export function getTurnOutcomeMarker(
  blocks: ContentBlock[] | undefined,
): ContentBlock | null {
  if (!Array.isArray(blocks)) return null;
  return blocks.find((block) => (
    Boolean(block)
    && typeof block === "object"
    && block.type === "turn_outcome_marker"
  )) ?? null;
}

export function shouldHideTimelineInteraction(interaction: Interaction): boolean {
  if (getProtectedRecoveryControlIntent(interaction.content_blocks)) return true;
  const outcome = getTurnOutcomeMarker(interaction.content_blocks);
  return interaction.type === "agent"
    && !interaction.content.trim()
    && outcome?.kind === "recovery"
    && outcome.severity === "info";
}

export function normalizePost(raw: Record<string, unknown>): Interaction {
  const data =
    raw.data && typeof raw.data === "object"
      ? (raw.data as Record<string, unknown>)
      : undefined;
  const rawType = raw.type ?? data?.type;

  return {
    id: Number(raw.id ?? 0),
    type: (rawType === "user" || rawType === "user_message"
      ? "user"
      : "agent") as "user" | "agent",
    content: String(raw.content ?? data?.content ?? ""),
    content_blocks: (raw.content_blocks ?? data?.content_blocks) as
      | ContentBlock[]
      | undefined,
    media_ids: (raw.media_ids ?? data?.media_ids) as number[] | undefined,
    created_at: String(raw.created_at ?? raw.timestamp ?? ""),
    data,
  };
}

export function mergeInteractions(
  existing: Interaction[],
  incoming: Interaction[]
): Interaction[] {
  const byId = new Map<number, Interaction>();
  for (const msg of existing) {
    byId.set(msg.id, msg);
  }
  for (const msg of incoming) {
    byId.set(msg.id, msg);
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}
