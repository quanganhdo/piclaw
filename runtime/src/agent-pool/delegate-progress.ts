/** Display-only native child progress. No transcript, arguments or reasoning. */
export type NativeDelegateProgress = {
  kind: "native_delegate_progress";
  conversationId: number;
  model: string;
  phase: "starting" | "working" | "generating" | "tool" | "retrying" | "done" | "failed";
  tools: string[];
  responseChars: number;
  elapsedSeconds: number;
};
const phases = new Set(["starting", "working", "generating", "tool", "retrying", "done", "failed"]);
const tools = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);
export function readNativeDelegateProgress(value: unknown): NativeDelegateProgress | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (p.kind !== "native_delegate_progress" || !Number.isSafeInteger(p.conversationId) || Number(p.conversationId) <= 0 ||
      typeof p.model !== "string" || p.model.length > 256 || !/^[\w.-]+\/[\w.:/@+\-]+$/.test(p.model) ||
      typeof p.phase !== "string" || !phases.has(p.phase) || !Array.isArray(p.tools) || p.tools.length > 8 ||
      p.tools.some(tool => typeof tool !== "string" || !tools.has(tool)) ||
      !Number.isSafeInteger(p.responseChars) || Number(p.responseChars) < 0 || Number(p.responseChars) > 1_000_000_000 ||
      !Number.isSafeInteger(p.elapsedSeconds) || Number(p.elapsedSeconds) < 0 || Number(p.elapsedSeconds) > 86400) return null;
  return { kind: "native_delegate_progress", conversationId: Number(p.conversationId), model: p.model,
    phase: p.phase as NativeDelegateProgress["phase"], tools: [...p.tools], responseChars: Number(p.responseChars), elapsedSeconds: Number(p.elapsedSeconds) };
}
export function formatNativeDelegateProgress(p: NativeDelegateProgress, ordinal: number, total: number): string {
  const action = p.phase === "tool" ? `Running ${p.tools.join(", ") || "tool"}`
    : p.phase === "generating" ? "Generating response" : p.phase === "retrying" ? "Provider retry"
      : p.phase === "done" ? "Completed" : p.phase === "failed" ? "Failed" : p.phase === "starting" ? "Starting" : "Working";
  return `Delegate ${ordinal}/${total} — ${p.model}\nProgress: ${action} · ${p.elapsedSeconds}s · ${p.responseChars} response characters`;
}
