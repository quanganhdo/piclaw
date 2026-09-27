/* Repair orphan tool results in the persisted SessionManager projection. */
import { buildContextEntries, sessionEntryToContextMessages, type AgentSession } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../utils/logger.js";

interface ContentBlock {
  type?: unknown;
  id?: unknown;
  toolCallId?: unknown;
  toolUseId?: unknown;
  tool_use_id?: unknown;
}
interface MessageRecord {
  role?: unknown;
  content?: unknown;
  toolCallId?: unknown;
  toolUseId?: unknown;
  tool_use_id?: unknown;
}
interface SourceEntry { id: string; type: string; message?: MessageRecord }
interface ProjectionEntry { sourceEntry: SourceEntry; messages: MessageRecord[] }
interface RepairManager {
  getEntries(): ReturnType<AgentSession["sessionManager"]["getEntries"]>;
  getLeafId(): string | null;
  buildSessionProjection?: () => { entries: ProjectionEntry[] };
  appendContextEdit?: (targetId: string, replacement: { content: unknown[] } | null) => string;
}

const log = createLogger("agent-pool.orphan-tool-results");

function getToolCallIds(value: { id?: unknown; toolCallId?: unknown; toolUseId?: unknown; tool_use_id?: unknown }): string[] {
  const ids: string[] = [];
  for (const key of ["id", "toolCallId", "toolUseId", "tool_use_id"] as const) {
    const raw = value[key];
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id) continue;
    ids.push(id);
    const baseId = id.split("|", 1)[0]?.trim();
    if (baseId && baseId !== id) ids.push(baseId);
  }
  return ids;
}

function hasKnownToolCallId(value: ContentBlock, toolCallIds: Set<string>): boolean {
  return getToolCallIds(value).some((id) => toolCallIds.has(id));
}

function isToolCallBlock(block: ContentBlock): boolean {
  return block.type === "toolCall" || block.type === "toolUse" || block.type === "tool_call" || block.type === "tool_use";
}
function isToolResultBlock(block: ContentBlock): boolean {
  return block.type === "toolResult" || block.type === "tool_result";
}
function isToolResultMessage(message: MessageRecord): boolean {
  return message.role === "toolResult" || message.role === "tool_result";
}

function projection(manager: RepairManager): ProjectionEntry[] {
  if (typeof manager.buildSessionProjection === "function") return manager.buildSessionProjection().entries;
  // Fallback for older managers without buildSessionProjection; repair still
  // requires appendContextEdit and fails closed when that method is absent.
  const entries = manager.getEntries();
  if (!entries.some((entry) => entry.type === "message" && !!entry.message || entry.type === "custom_message")) return [];
  const selected = buildContextEntries(entries, manager.getLeafId());
  if (selected.some((entry) => (entry as { type: string }).type === "context_edit")) {
    // An older manager cannot project active persisted edits. Rebuilding raw
    // messages would resurrect omitted results and append a duplicate repair.
    throw new Error("SessionManager cannot project persisted context edits; restore the pre-upgrade session snapshot.");
  }
  return selected.map((sourceEntry) => ({
    sourceEntry: sourceEntry as SourceEntry,
    messages: sessionEntryToContextMessages(sourceEntry) as MessageRecord[],
  }));
}

/**
 * Append an edit for each orphaned source entry. Never mutate agent.state.messages:
 * 0.87.1 rebuilds that array from the SessionManager projection before prompting.
 * A manager without appendContextEdit fails closed if repair is needed.
 */
export function pruneOrphanToolResults(session: AgentSession, chatJid: string): number {
  const manager = session.sessionManager as unknown as RepairManager;
  if (!manager || typeof manager.getEntries !== "function" || typeof manager.getLeafId !== "function") {
    const state = (session as unknown as { agent?: { state?: { messages?: unknown[] } } }).agent?.state?.messages;
    if (!Array.isArray(state) || state.length === 0) return 0;
    throw new Error("Cannot inspect canonical session context for orphan tool results.");
  }
  const entries = projection(manager);
  const toolCallIds = new Set<string>();
  for (const { messages } of entries) for (const message of messages) {
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (!block || typeof block !== "object" || !isToolCallBlock(block as ContentBlock)) continue;
      for (const id of getToolCallIds(block as ContentBlock)) toolCallIds.add(id);
    }
  }

  const edits: { targetId: string; replacement: { content: unknown[] } | null; count: number }[] = [];
  for (const { sourceEntry, messages } of entries) {
    let count = 0;
    let replacement: { content: unknown[] } | null | undefined;
    for (const message of messages) {
      if (isToolResultMessage(message)) {
        if (hasKnownToolCallId(message, toolCallIds)) continue;
        count += 1;
        replacement = null;
        continue;
      }
      if (!Array.isArray(message.content)) continue;
      const filtered = message.content.filter((block) => {
        if (!block || typeof block !== "object" || !isToolResultBlock(block as ContentBlock)
          || hasKnownToolCallId(block as ContentBlock, toolCallIds)) return true;
        count += 1;
        return false;
      });
      if (filtered.length !== message.content.length) replacement = { content: filtered };
    }
    if (!count) continue;
    if (!sourceEntry?.id || messages.length !== 1
      || !(sourceEntry.type === "custom_message" || sourceEntry.type === "message"
        && ["user", "assistant", "toolResult"].includes(String(sourceEntry.message?.role)))) {
      throw new Error("Orphan tool result has no exact editable session entry.");
    }
    edits.push({ targetId: sourceEntry.id, replacement: replacement ?? null, count });
  }
  if (edits.length === 0) {
    // A fixture can expose mutable agent messages without canonical entries.
    // That state must never be treated as a durable repair source.
    return 0;
  }
  if (typeof manager.appendContextEdit !== "function") {
    throw new Error("Cannot persist orphan tool-result repair with the pinned SessionManager; restore or rotate the session before prompting.");
  }
  // All mappings are checked before the first append. A failed append is never reported as a repair.
  for (const edit of edits) manager.appendContextEdit(edit.targetId, edit.replacement);
  const repaired = projection(manager);
  for (const edit of edits) {
    const target = repaired.filter(({ sourceEntry }) => sourceEntry.id === edit.targetId);
    if (target.length !== 1 || (edit.replacement === null
      ? target[0]!.messages.length !== 0
      : target[0]!.messages.length !== 1 || JSON.stringify(target[0]!.messages[0]?.content) !== JSON.stringify(edit.replacement.content))) {
      throw new Error("SessionManager did not project the persisted orphan tool-result repair.");
    }
  }
  const repairedCallIds = new Set<string>();
  for (const { messages } of repaired) for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!block || typeof block !== "object" || !isToolCallBlock(block as ContentBlock)) continue;
      for (const id of getToolCallIds(block as ContentBlock)) repairedCallIds.add(id);
    }
  }
  const remaining = repaired.flatMap(({ messages }) => messages).some((message) =>
    isToolResultMessage(message) && !hasKnownToolCallId(message, repairedCallIds)
    || Array.isArray(message.content) && message.content.some((block) => block && typeof block === "object"
      && isToolResultBlock(block as ContentBlock) && !hasKnownToolCallId(block as ContentBlock, repairedCallIds)));
  if (remaining) throw new Error("SessionManager did not project the persisted orphan tool-result repair.");
  const prunedCount = edits.reduce((sum, edit) => sum + edit.count, 0);
  log.warn("Persisted orphan tool-result context edits", {
    operation: "orphan_tool_results.prune", chatJid, prunedCount,
  });
  return prunedCount;
}
