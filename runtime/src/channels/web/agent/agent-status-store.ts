/**
 * channels/web/agent-status-store.ts – bounded in-memory native web status observations.
 */


const STATUS_RUNTIME_GENERATION = [
  String(process.pid || "0"),
  Date.now().toString(36),
  Math.random().toString(36).slice(2, 10),
].join(":");

const STATUS_RUNTIME_GENERATION_KEY = "runtime_generation";

function withRuntimeGeneration(status: Record<string, unknown>): Record<string, unknown> {
  return {
    ...status,
    [STATUS_RUNTIME_GENERATION_KEY]: STATUS_RUNTIME_GENERATION,
  };
}

/** Bounded process-local observations; SDK watches reconstruct state after attach. */
export class AgentStatusStore {
  private activeAgentStatuses = new Map<string, Record<string, unknown>>();
  private terminalStatusExpiresAt = new Map<string, number>();
  private terminalStatusTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly terminalStatusTtlMs = 15_000,
    private readonly limit = 128,
  ) {}

  private clearTerminalStatusTimer(chatJid: string): void {
    const timer = this.terminalStatusTimers.get(chatJid);
    if (timer) clearTimeout(timer);
    this.terminalStatusTimers.delete(chatJid);
  }

  private clearAllTerminalStatusTimers(): void {
    for (const timer of this.terminalStatusTimers.values()) clearTimeout(timer);
    this.terminalStatusTimers.clear();
  }

  private scheduleTerminalStatusExpiry(chatJid: string, expiresAt: number): void {
    this.clearTerminalStatusTimer(chatJid);
    const timer = setTimeout(() => {
      if (this.terminalStatusExpiresAt.get(chatJid) !== expiresAt) return;
      this.activeAgentStatuses.delete(chatJid);
      this.terminalStatusExpiresAt.delete(chatJid);
      this.terminalStatusTimers.delete(chatJid);
    }, Math.max(0, expiresAt - Date.now()));
    (timer as { unref?: () => void }).unref?.();
    this.terminalStatusTimers.set(chatJid, timer);
  }

  update(chatJid: string, status: Record<string, unknown>): void {
    const type = status?.type;
    const stamped = withRuntimeGeneration(status);
    this.activeAgentStatuses.delete(chatJid);
    this.activeAgentStatuses.set(chatJid, stamped);
    while (this.activeAgentStatuses.size > this.limit) {
      const oldest = this.activeAgentStatuses.keys().next().value!;
      this.activeAgentStatuses.delete(oldest);
      this.terminalStatusExpiresAt.delete(oldest);
      this.clearTerminalStatusTimer(oldest);
    }
    if (type === "done" || type === "error") {
      const expiresAt = Date.now() + this.terminalStatusTtlMs;
      this.terminalStatusExpiresAt.set(chatJid, expiresAt);
      this.scheduleTerminalStatusExpiry(chatJid, expiresAt);
      return;
    }
    this.clearTerminalStatusTimer(chatJid);
    this.terminalStatusExpiresAt.delete(chatJid);
  }

  get(chatJid: string): Record<string, unknown> | null {
    const active = this.activeAgentStatuses.get(chatJid);
    if (active) {
      const expiresAt = this.terminalStatusExpiresAt.get(chatJid);
      if (expiresAt === undefined || expiresAt > Date.now()) return active;
      this.activeAgentStatuses.delete(chatJid);
      this.terminalStatusExpiresAt.delete(chatJid);
      this.clearTerminalStatusTimer(chatJid);
    }

    return null;
  }

  dispose(): void {
    this.activeAgentStatuses.clear();
    this.clearAllTerminalStatusTimers();
    this.terminalStatusExpiresAt.clear();
  }
}
