import { MCP_ENGINE_SWITCH_EFFECT, parseMcpEnginePolicy, type McpEnginePolicy } from "./mcp-engine-policy.js";

/** Public AgentSession.abort/reload surface; no private extension runner access. */
export interface McpReloadSession {
  abort(): Promise<void>;
  /** Hook rejection must propagate; never catch it and proceed to startup. */
  reload(options: { beforeSessionStart: () => Promise<void> }): Promise<void>;
}
export interface McpEngineSwitchHost {
  validate(policy: Readonly<McpEnginePolicy>, signal: AbortSignal): void | Promise<void>;
  /**
   * Close admission and fence old executions synchronously before yielding,
   * then drain pre-fence creations and return the complete participant set.
   * Keep the fence closed on rejection/abort; later creations must not start.
   */
  fenceAndSnapshot(signal: AbortSignal): Promise<readonly McpReloadSession[]>;
  /** Select the inline factory after abort, before resource reload. */
  select(policy: Readonly<McpEnginePolicy>): void;
  /** Commit success only when resolved; honor abort before any late write. */
  persist(policy: Readonly<McpEnginePolicy>, signal: AbortSignal): Promise<void>;
  /** Idempotent, synchronous, non-throwing admission/execution fence. */
  blockAdmissions(): void;
  /** Idempotent public runtime teardown, including any late startup. */
  quarantine(session: McpReloadSession): Promise<void>;
  /** Atomically open admission, or throw without opening it. */
  resume(): void;
}
export interface McpEngineSwitchStatus {
  phase: "ready" | "switching" | "blocked";
  activePolicy: Readonly<McpEnginePolicy> | null;
  selectedPolicy: Readonly<McpEnginePolicy> | null;
  /** Null means commit outcome is unknown; never assume rollback. */
  persistedPolicy: Readonly<McpEnginePolicy> | null;
  error: string | null;
  effect: typeof MCP_ENGINE_SWITCH_EFFECT;
}

/**
 * Supported whole-extension reload coordination, not direct MCP disposal.
 * beforeSessionStart runs after old shutdown/tool rebuild. All starts wait
 * here until every participant arrives and the policy commit completes.
 * Timeout leaves host admission fenced and never releases the start barrier.
 */
export class McpEngineSwitchCoordinator {
  private phase: McpEngineSwitchStatus["phase"] = "ready";
  private error: string | null = null;
  private activePolicy: Readonly<McpEnginePolicy> | null;
  private selectedPolicy: Readonly<McpEnginePolicy> | null;
  private persistedPolicy: Readonly<McpEnginePolicy> | null;

  constructor(private readonly host: McpEngineSwitchHost, initial: Readonly<McpEnginePolicy>, private readonly timeoutMs = 30_000) {
    this.selectedPolicy = parseMcpEnginePolicy(initial);
    this.activePolicy = this.selectedPolicy;
    this.persistedPolicy = this.selectedPolicy;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid MCP switch deadline.");
  }

  status(): McpEngineSwitchStatus {
    return { phase: this.phase, activePolicy: this.activePolicy && { ...this.activePolicy }, selectedPolicy: this.selectedPolicy && { ...this.selectedPolicy },
      persistedPolicy: this.persistedPolicy && { ...this.persistedPolicy }, error: this.error, effect: MCP_ENGINE_SWITCH_EFFECT };
  }

  async apply(value: unknown): Promise<McpEngineSwitchStatus> {
    if (this.phase !== "ready") throw new Error("MCP engine switching is unavailable until the current transition is resolved.");
    const next = parseMcpEnginePolicy(value);
    if (next.engine === this.selectedPolicy?.engine && next.codemode === this.selectedPolicy.codemode) return this.status();
    this.phase = "switching";
    const controller = new AbortController();
    let rejectDeadline!: (error: Error) => void;
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
    const timer = setTimeout(() => {
      rejectDeadline(new Error("MCP switch deadline exceeded."));
      controller.abort();
    }, this.timeoutMs);
    const bounded = <T>(operation: () => T | Promise<T>): Promise<T> => Promise.race([Promise.resolve().then(operation), deadline]);
    // Observe abandoned operations without waiting on them during failure.
    let releaseStart!: () => void, rejectStart!: (error: Error) => void;
    const startBarrier = new Promise<void>((resolve, reject) => { releaseStart = resolve; rejectStart = reject; });
    void startBarrier.catch(() => undefined);
    let fenced = false, failed = false;
    let sessions: McpReloadSession[] = [];
    const quarantine = (session: McpReloadSession) => {
      // The host keeps its fence closed if cleanup fails; never expose details.
      void Promise.resolve().then(() => this.host.quarantine(session)).catch(() => undefined);
    };
    try {
      await bounded(() => this.host.validate(next, controller.signal));
      // Conservatively mark active ownership unavailable before host fencing.
      fenced = true;
      this.activePolicy = null;
      this.host.blockAdmissions();
      const snapshot = Promise.resolve().then(() => this.host.fenceAndSnapshot(controller.signal));
      void snapshot.then(participants => {
        if (failed) for (const session of new Set(participants)) quarantine(session);
      }, () => undefined);
      sessions = [...new Set(await bounded(() => snapshot))];
      const aborts = await bounded(() => Promise.allSettled(sessions.map(session => Promise.resolve().then(() => session.abort()))));
      if (aborts.some(result => result.status === "rejected")) throw new Error("MCP switch abort failed.");
      this.selectedPolicy = null;
      this.host.select(next);
      this.selectedPolicy = next;
      const reached = new Set<McpReloadSession>();
      let allReached!: () => void;
      const readyBarrier = new Promise<void>(resolve => { allReached = resolve; });
      if (!sessions.length) allReached();
      const reloads = sessions.map(session => Promise.resolve().then(() => session.reload({ beforeSessionStart: async () => {
        if (reached.has(session)) throw new Error("Duplicate MCP switch startup barrier.");
        reached.add(session);
        if (reached.size === sessions.length) allReached();
        await startBarrier;
      } })).then(() => {
        if (!reached.has(session)) throw new Error("Session reload bypassed the MCP switch startup barrier.");
      }).finally(() => { if (failed) quarantine(session); }));
      // Each pending reload has rejection observation before any later await.
      for (const reload of reloads) void reload.catch(() => undefined);
      const premature = Promise.race(reloads.map(reload => reload.then(() => { throw new Error("Session reload completed before switch release."); })));
      void premature.catch(() => undefined);
      if (sessions.length) await bounded(() => Promise.race([readyBarrier, premature]));
      this.persistedPolicy = null;
      await bounded(() => this.host.persist(next, controller.signal));
      this.persistedPolicy = next;
      releaseStart();
      const completed = await bounded(() => Promise.allSettled(reloads));
      if (completed.some(result => result.status === "rejected")) throw new Error("MCP switch startup failed.");
      this.host.resume();
      this.activePolicy = next;
      this.phase = "ready";
      this.error = null;
      return this.status();
    } catch {
      failed = true;
      controller.abort();
      if (!fenced) {
        this.phase = "ready";
        throw new Error("MCP engine policy validation failed or timed out.");
      }
      const failure = new Error("MCP engine switch failed; new MCP operations remain blocked.");
      this.host.blockAdmissions();
      this.phase = "blocked";
      this.error = failure.message;
      rejectStart(failure);
      for (const session of sessions) quarantine(session);
      throw failure;
    } finally { clearTimeout(timer); }
  }
}
