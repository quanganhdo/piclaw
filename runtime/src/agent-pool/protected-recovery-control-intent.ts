import { TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT } from "./context-pressure-retry.js";

export const PROTECTED_RECOVERY_CONTROL_INTENT = "protected_recovery_continuation";
export const PROTECTED_RECOVERY_CONTROL_LABEL = "Recovery resumed with execution tools";

export interface ProtectedRecoveryControlIntentBlock {
  type: "control_intent";
  intent: typeof PROTECTED_RECOVERY_CONTROL_INTENT;
  schema_version: 1;
  label: typeof PROTECTED_RECOVERY_CONTROL_LABEL;
  source_message_id: string;
  source_row_id: number;
  thread_id: number;
  /** One-based depth of the bounded protected-recovery handoff chain. */
  handoff_depth: number;
}

interface MessageLike {
  content?: unknown;
  content_blocks?: unknown;
}

function findControlIntentBlock(contentBlocks: unknown): ProtectedRecoveryControlIntentBlock | null {
  if (!Array.isArray(contentBlocks)) return null;
  const block = contentBlocks.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const value = candidate as Record<string, unknown>;
    const handoffDepth = value.handoff_depth ?? 1;
    return value.type === "control_intent"
      && value.intent === PROTECTED_RECOVERY_CONTROL_INTENT
      && value.schema_version === 1
      && typeof value.source_message_id === "string"
      && value.source_message_id.trim().length > 0
      && Number.isInteger(value.source_row_id)
      && Number(value.source_row_id) > 0
      && Number.isInteger(value.thread_id)
      && Number(value.thread_id) > 0
      && Number.isInteger(handoffDepth)
      && Number(handoffDepth) > 0;
  }) as Record<string, unknown> | undefined;
  if (!block) return null;
  return {
    ...block,
    handoff_depth: Number(block.handoff_depth ?? 1),
  } as ProtectedRecoveryControlIntentBlock;
}

export function buildProtectedRecoveryControlIntentBlock(options: {
  sourceMessageId: string;
  sourceRowId: number;
  threadId: number;
  handoffDepth?: number;
}): ProtectedRecoveryControlIntentBlock {
  return {
    type: "control_intent",
    intent: PROTECTED_RECOVERY_CONTROL_INTENT,
    schema_version: 1,
    label: PROTECTED_RECOVERY_CONTROL_LABEL,
    source_message_id: options.sourceMessageId,
    source_row_id: options.sourceRowId,
    thread_id: options.threadId,
    handoff_depth: options.handoffDepth ?? 1,
  };
}

export function resolveProtectedRecoveryControlIntent(message: MessageLike): ProtectedRecoveryControlIntentBlock | null {
  return findControlIntentBlock(message.content_blocks);
}

export function isProtectedRecoveryControlMessage(message: MessageLike): boolean {
  return Boolean(resolveProtectedRecoveryControlIntent(message));
}

export function resolveProtectedRecoveryPrompt(message: MessageLike): string | null {
  return resolveProtectedRecoveryControlIntent(message)
    ? TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT
    : null;
}
