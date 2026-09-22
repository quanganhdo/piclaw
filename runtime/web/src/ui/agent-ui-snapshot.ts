/** Shared Classic/Visual transport. One cached reply and in-flight request per
 * chat; a full catalogue remains an on-demand picker/settings request. */
export interface AgentUiSnapshot {
  status: any;
  model: any;
  context: any;
  metrics: any;
  agent_name: string;
  errors: string[];
}
interface Entry {
  value?: AgentUiSnapshot;
  completedAt: number;
  generation: number;
  inFlight?: Promise<AgentUiSnapshot>;
}
const entries = new Map<string, Entry>();
export const AGENT_UI_POLL_MS = 5000;
export function currentUiChatJid(): string {
  if (typeof window === "undefined") return "web:default";
  return (
    (window as any).__piclawCurrentChatJid ||
    new URL(location.href).searchParams.get("chat_jid") ||
    "web:default"
  );
}
export function invalidateAgentUiSnapshot(chatJid = currentUiChatJid()): void {
  const entry = entries.get(chatJid);
  if (entry) {
    entry.completedAt = 0;
    entry.generation++;
  }
}
export function getAgentUiSnapshot(
  chatJid = currentUiChatJid(),
): Promise<AgentUiSnapshot> {
  let entry = entries.get(chatJid);
  if (!entry) {
    // Do not retain passive data for an unbounded history of visited chats.
    if (entries.size >= 32)
      for (const [key, item] of entries) {
        if (!item.inFlight) {
          entries.delete(key);
          break;
        }
      }
    entry = { completedAt: 0, generation: 0 };
    entries.set(chatJid, entry);
  }
  if (entry.inFlight) return entry.inFlight;
  // Leave 250ms for interval/async scheduling skew: a five-second tick must
  // not miss freshness by a millisecond and defer the next update to ten.
  if (
    entry.value &&
    entry.completedAt > 0 &&
    Date.now() - entry.completedAt < AGENT_UI_POLL_MS - 250
  )
    return Promise.resolve(entry.value);
  const state = entry,
    generation = state.generation,
    startedAt = Date.now();
  state.inFlight = (async () => {
    const response = await fetch(
      `/agent/status?chat_jid=${encodeURIComponent(chatJid)}&ui=1`,
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error(`UI snapshot HTTP ${response.status}`);
    const next = (await response.json()) as AgentUiSnapshot;
    if (!next || !next.status || !Array.isArray(next.errors))
      throw new Error("Invalid UI snapshot");
    if (generation !== state.generation) {
      // An event invalidated this response while its body was pending. All
      // joiners await one replacement rather than applying pre-event state.
      state.inFlight = undefined;
      return getAgentUiSnapshot(chatJid);
    }
    for (const key of ["status", "model", "context", "metrics"] as const) {
      if (
        state.value &&
        JSON.stringify(state.value[key]) === JSON.stringify(next[key])
      )
        next[key] = state.value[key];
    }
    state.value = next;
    state.completedAt = startedAt;
    return next;
  })().finally(() => {
    if (state.inFlight === pending) state.inFlight = undefined;
  });
  const pending = state.inFlight;
  return pending;
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  for (const name of [
    "piclaw:sse-connected",
    "piclaw:model-state-changed",
    "piclaw:agent-status",
    "piclaw:current-chat-changed",
  ]) {
    window.addEventListener(name, (event) => {
      const detail = (event as CustomEvent).detail;
      // Token/tool progress can arrive faster than a network round trip. It
      // already travels over SSE; only terminal events invalidate polling.
      if (
        name === "piclaw:agent-status" &&
        !["done", "error"].includes(detail?.type) &&
        detail?.status !== "idle"
      )
        return;
      invalidateAgentUiSnapshot(
        detail?.chatJid || detail?.chat_jid || currentUiChatJid(),
      );
    });
  }
}
