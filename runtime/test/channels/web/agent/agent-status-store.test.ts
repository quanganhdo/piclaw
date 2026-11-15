import { describe, expect, test } from "bun:test";
import { AgentStatusStore } from "../../../../src/channels/web/agent/agent-status-store.js";

describe("web agent status store", () => {
  test("fresh status observations have no persistent restore or cleanup entrypoint", () => {
    const store=new AgentStatusStore();
    expect(store.get("web:1")).toBeNull();expect(store.get("web:2")).toBeNull();
    expect(store).not.toHaveProperty("load");expect(store).not.toHaveProperty("clearPersistedStatuses");
  });

  test("update is in-memory only — no persistence calls", () => {
    const store = new AgentStatusStore();

    store.update("web:1", { type: "intent", title: "Thinking" });
    expect(store.get("web:1")).toMatchObject({ type: "intent", title: "Thinking" });

    store.update("web:1", { type: "done", title: "Completed /session-rotate" });
    expect(store.get("web:1")).toMatchObject({ type: "done", title: "Completed /session-rotate" });

    // Phase 3: update() must not touch persistence at all
    expect(store).not.toHaveProperty("state");
    expect(store).not.toHaveProperty("load");
  });

  test("terminal status remains pollable briefly, then expires", async () => {
    // Leave a real observation window: a 1 ms timer can expire between update()
    // and the first assertion on a busy hosted runner, testing scheduler timing
    // rather than the store's terminal-status contract.
    const store = new AgentStatusStore(50);

    store.update("web:terminal", { type: "error", title: "Rotation failed" });
    expect(store.get("web:terminal")).toMatchObject({ type: "error", title: "Rotation failed" });
    expect((store as any).terminalStatusTimers.size).toBe(1);
    await Bun.sleep(80);
    expect((store as any).activeAgentStatuses.has("web:terminal")).toBe(false);
    expect((store as any).terminalStatusTimers.size).toBe(0);
    expect(store.get("web:terminal")).toBeNull();
  });

  test("a newer active status cancels pending terminal expiry", async () => {
    const store = new AgentStatusStore(5);

    store.update("web:replacement", { type: "done", title: "First run completed" });
    store.update("web:replacement", { type: "intent", title: "Second run started" });
    await Bun.sleep(10);

    expect(store.get("web:replacement")).toMatchObject({ type: "intent", title: "Second run started" });
    expect((store as any).terminalStatusTimers.size).toBe(0);
  });

  test("capacity eviction releases terminal expiry resources without discarding newer observations", () => {
    const store = new AgentStatusStore(15000, 2);
    try {
      store.update("old-terminal", { type: "done" });
      store.update("new-terminal", { type: "error" });
      expect((store as any).terminalStatusTimers.size).toBe(2);
      store.update("active", { type: "tool_call" });
      expect(store.get("old-terminal")).toBeNull();
      expect((store as any).terminalStatusTimers.has("old-terminal")).toBe(false);
      expect((store as any).terminalStatusExpiresAt.has("old-terminal")).toBe(false);
      expect((store as any).terminalStatusTimers.size).toBe(1);
      expect(store.get("new-terminal")).toMatchObject({ type: "error" });
      expect(store.get("active")).toMatchObject({ type: "tool_call" });
    } finally { store.dispose(); }
  });

  test("dispose clears only process-local observations and their actual expiry timers", () => {
    const store=new AgentStatusStore();store.update("web:1",{type:"thinking"});store.update("web:2",{type:"done"});
    expect((store as any).terminalStatusTimers.size).toBe(1);store.dispose();
    expect(store.get("web:1")).toBeNull();expect(store.get("web:2")).toBeNull();
    expect((store as any).terminalStatusTimers.size).toBe(0);expect((store as any).terminalStatusExpiresAt.size).toBe(0);
  });
});
