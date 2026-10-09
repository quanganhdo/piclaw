import { expect, test } from "bun:test";
import { DEFAULT_MCP_ENGINE_POLICY, MCP_ENGINE_SWITCH_EFFECT, parseMcpEnginePolicy, resolveMcpCodemode } from "../../src/agent-pool/mcp-engine-policy.js";
import { McpEngineSwitchCoordinator, type McpReloadSession } from "../../src/agent-pool/mcp-engine-switch.js";

const next = { engine: "native", codemode: "auto" } as const;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
function fixture(sessions: McpReloadSession[]) {
  const events: string[] = [];
  const host = {
    validate: async () => { events.push("validate"); },
    fenceAndSnapshot: async (_signal: AbortSignal) => { events.push("fence"); return sessions; },
    select: () => { events.push("select"); },
    persist: async () => { events.push("persist"); },
    blockAdmissions: () => {},
    quarantine: async (_session: McpReloadSession) => {},
    resume: () => { events.push("resume"); },
  };
  return { host, events, coordinator: new McpEngineSwitchCoordinator(host, DEFAULT_MCP_ENGINE_POLICY, 500) };
}

test("instance policy defaults and codemode decisions are strict", () => {
  expect(DEFAULT_MCP_ENGINE_POLICY).toEqual({ engine: "adapter", codemode: "auto" });
  expect(parseMcpEnginePolicy(next)).toEqual(next);
  for (const value of [null, [], {}, { ...next, engine: "fallback" }, { ...next, codemode: "yes" }, { ...next, secret: "private" }]) expect(() => parseMcpEnginePolicy(value)).toThrow();
  expect(resolveMcpCodemode(DEFAULT_MCP_ENGINE_POLICY, false)).toBe(false);
  expect(resolveMcpCodemode(DEFAULT_MCP_ENGINE_POLICY, true)).toBe(true);
  expect(resolveMcpCodemode({ engine: "native", codemode: "on" }, false)).toBe(true);
  expect(resolveMcpCodemode({ engine: "native", codemode: "off" }, false)).toBe(false);
  expect(() => resolveMcpCodemode({ engine: "native", codemode: "off" }, true)).toThrow("requires codemode");
});

test("switch aborts all sessions and holds every startup until all shutdowns and persistence finish", async () => {
  const stopped = deferred(), persisted = deferred(), entered = deferred();
  const lifecycle: string[] = [];
  const session = (id: string): McpReloadSession => ({
    abort: async () => { lifecycle.push(`abort:${id}`); },
    reload: async options => {
      lifecycle.push(`shutdown:${id}`);
      if (id === "slow") { entered.resolve(); await stopped.promise; }
      await options.beforeSessionStart();
      lifecycle.push(`start:${id}`);
    },
  });
  const fast = session("fast"), slow = session("slow");
  const f = fixture([fast, slow, fast]);
  f.host.persist = async () => { f.events.push("persist"); await persisted.promise; };
  const applying = f.coordinator.apply(next);
  await entered.promise;
  expect(f.coordinator.status().phase).toBe("switching");
  expect(lifecycle).toEqual(["abort:fast", "abort:slow", "shutdown:fast", "shutdown:slow"]);
  expect(f.events).toEqual(["validate", "fence", "select"]);
  await expect(f.coordinator.apply(next)).rejects.toThrow("unavailable");
  stopped.resolve(); await Bun.sleep(0);
  expect(f.events).toContain("persist"); expect(lifecycle.some(event => event.startsWith("start:"))).toBe(false);
  persisted.resolve();
  expect(await applying).toEqual({ phase: "ready", activePolicy: next, selectedPolicy: next, persistedPolicy: next, error: null, effect: MCP_ENGINE_SWITCH_EFFECT });
  expect(lifecycle.slice(-2).sort()).toEqual(["start:fast", "start:slow"]);
  expect(f.events).toEqual(["validate", "fence", "select", "persist", "resume"]);
});

test("validation rejection leaves old ownership untouched and does not disclose its error", async () => {
  const f = fixture([]);
  f.host.validate = async () => { throw new Error("PRIVATE-VALIDATION-SENTINEL"); };
  await expect(f.coordinator.apply(next)).rejects.toThrow("validation failed");
  expect(f.events).toEqual([]);
  expect(f.coordinator.status()).toMatchObject({ phase: "ready", activePolicy: DEFAULT_MCP_ENGINE_POLICY, selectedPolicy: DEFAULT_MCP_ENGINE_POLICY, persistedPolicy: DEFAULT_MCP_ENGINE_POLICY, error: null });
});

for (const mode of ["abort", "reload", "bypass", "persist", "start"]) {
  test(`switch remains fenced without fallback after ${mode} failure`, async () => {
    const lifecycle: string[] = [];
    const session: McpReloadSession = {
      abort: async () => { lifecycle.push("abort"); if (mode === "abort") throw new Error("PRIVATE-FAILURE-SENTINEL"); },
      reload: async options => {
        lifecycle.push("shutdown");
        if (mode === "reload") throw new Error("PRIVATE-FAILURE-SENTINEL");
        if (mode === "bypass") return;
        await options.beforeSessionStart();
        if (mode === "start") throw new Error("PRIVATE-FAILURE-SENTINEL");
        lifecycle.push("start");
      },
    };
    const f = fixture([session]);
    if (mode === "persist") f.host.persist = async () => { throw new Error("PRIVATE-FAILURE-SENTINEL"); };
    await expect(f.coordinator.apply(next)).rejects.toThrow("remain blocked");
    expect(f.coordinator.status().phase).toBe("blocked");
    expect(f.coordinator.status().activePolicy).toBeNull();
    expect(f.coordinator.status().selectedPolicy).toEqual(mode === "abort" ? DEFAULT_MCP_ENGINE_POLICY : next);
    expect(f.coordinator.status().persistedPolicy).toEqual(mode === "persist" ? null : mode === "start" ? next : DEFAULT_MCP_ENGINE_POLICY);
    expect(JSON.stringify(f.coordinator.status())).not.toContain("PRIVATE-FAILURE-SENTINEL");
    expect(f.events).not.toContain("resume");
    expect(f.events.filter(event => event === "select")).toHaveLength(mode === "abort" ? 0 : 1);
    if (mode !== "start") expect(lifecycle).not.toContain("start");
    await expect(f.coordinator.apply(DEFAULT_MCP_ENGINE_POLICY)).rejects.toThrow("unavailable");
  });
}

test("unchanged policy is a no-op, and an empty instance can commit without reload", async () => {
  const f = fixture([]);
  await f.coordinator.apply(DEFAULT_MCP_ENGINE_POLICY); expect(f.events).toEqual([]);
  await f.coordinator.apply(next); expect(f.events).toEqual(["validate", "fence", "select", "persist", "resume"]);
});

for (const stage of ["fence", "abort", "reload", "persist", "start"] as const) {
  test(`a non-settling ${stage} fails within the switch deadline without resuming admissions`, async () => {
    const never = new Promise<void>(() => {});
    const session: McpReloadSession = {
      abort: () => stage === "abort" ? never : Promise.resolve(),
      reload: async options => { if (stage === "reload") await never; await options.beforeSessionStart(); if (stage === "start") await never; },
    };
    const f = fixture([session]);
    let signal: AbortSignal | undefined;
    if (stage === "fence") f.host.fenceAndSnapshot = async current => { f.events.push("fence"); signal = current; await never; return [session]; };
    if (stage === "persist") f.host.persist = async () => { f.events.push("persist"); await never; };
    const coordinator = new McpEngineSwitchCoordinator(f.host, DEFAULT_MCP_ENGINE_POLICY, 25);
    const started = performance.now();
    await expect(coordinator.apply(next)).rejects.toThrow("remain blocked");
    expect(performance.now() - started).toBeLessThan(750);
    expect(coordinator.status().phase).toBe("blocked"); expect(coordinator.status().activePolicy).toBeNull();
    expect(f.events).not.toContain("resume");
    if (signal) expect(signal.aborted).toBe(true);
  });
}

test("admissions completing during fencing are included before any abort or selection", async () => {
  const admission = deferred(), entered = deferred();
  const lifecycle: string[] = [];
  const pending: McpReloadSession = { abort: async () => { lifecycle.push("abort:pending"); }, reload: async options => { lifecycle.push("shutdown:pending"); await options.beforeSessionStart(); lifecycle.push("start:pending"); } };
  const f = fixture([]);
  f.host.fenceAndSnapshot = async () => { f.events.push("fence"); entered.resolve(); await admission.promise; return [pending]; };
  const applying = f.coordinator.apply(next);
  await entered.promise;
  expect(f.events).toEqual(["validate", "fence"]); expect(lifecycle).toEqual([]);
  admission.resolve(); await applying;
  expect(lifecycle).toEqual(["abort:pending", "shutdown:pending", "start:pending"]);
});

test("late snapshot participants are quarantined after deadline without reopening admission", async () => {
  const late = deferred(), captured: McpReloadSession[] = [];
  const session: McpReloadSession = { abort: async () => {}, reload: async options => { await options.beforeSessionStart(); } };
  const f = fixture([]);
  f.host.fenceAndSnapshot = async () => { await late.promise; return [session]; };
  f.host.quarantine = async current => { captured.push(current); await current.abort(); };
  const coordinator = new McpEngineSwitchCoordinator(f.host, DEFAULT_MCP_ENGINE_POLICY, 25);
  await expect(coordinator.apply(next)).rejects.toThrow("remain blocked");
  late.resolve(); await Bun.sleep(0);
  expect(captured).toEqual([session]); expect(f.events).not.toContain("resume");
});

test("late startup completion after deadline is quarantined again with admissions fenced", async () => {
  const delayed = deferred(); let cleaned = 0, blocks = 0;
  const session: McpReloadSession = { abort: async () => {}, reload: async options => { await options.beforeSessionStart(); await delayed.promise; } };
  const f = fixture([session]);
  f.host.blockAdmissions = () => { blocks++; };
  f.host.quarantine = async () => { cleaned++; };
  const coordinator = new McpEngineSwitchCoordinator(f.host, DEFAULT_MCP_ENGINE_POLICY, 25);
  await expect(coordinator.apply(next)).rejects.toThrow("remain blocked");
  await Bun.sleep(0); expect(cleaned).toBe(1);
  delayed.resolve(); await Bun.sleep(0);
  expect(cleaned).toBe(2); expect(blocks).toBe(2); expect(f.events).not.toContain("resume");
});

test("resume failure re-closes admission and quarantines already reloaded sessions", async () => {
  let open = false, cleaned = 0;
  const session: McpReloadSession = { abort: async () => {}, reload: async options => { await options.beforeSessionStart(); } };
  const f = fixture([session]);
  f.host.blockAdmissions = () => { open = false; };
  // Defensive re-fencing also covers a host violating atomic-resume semantics.
  f.host.resume = () => { open = true; throw new Error("PRIVATE-RESUME-SENTINEL"); };
  f.host.quarantine = async () => { cleaned++; };
  await expect(f.coordinator.apply(next)).rejects.toThrow("remain blocked");
  await Bun.sleep(0);
  expect(open).toBe(false); expect(cleaned).toBe(1);
  expect(f.coordinator.status()).toMatchObject({ phase: "blocked", activePolicy: null, selectedPolicy: next, persistedPolicy: next });
});

test("duplicate startup hook rejection fails the switch rather than resuming admission", async () => {
  const session: McpReloadSession = { abort: async () => {}, reload: async options => { await options.beforeSessionStart(); await options.beforeSessionStart(); } };
  const f = fixture([session]);
  await expect(f.coordinator.apply(next)).rejects.toThrow("remain blocked");
  expect(f.events).not.toContain("resume"); expect(f.coordinator.status().phase).toBe("blocked");
});

test("selection mutation followed by a throw reports unknown selection without fallback", async () => {
  const f = fixture([]); let selected = DEFAULT_MCP_ENGINE_POLICY;
  f.host.select = () => { selected = next; throw new Error("PRIVATE-SELECT-SENTINEL"); };
  await expect(f.coordinator.apply(next)).rejects.toThrow("remain blocked");
  expect(selected).toEqual(next);
  expect(f.coordinator.status()).toMatchObject({ phase: "blocked", activePolicy: null, selectedPolicy: null, persistedPolicy: DEFAULT_MCP_ENGINE_POLICY });
  expect(f.events).not.toContain("resume");
});
