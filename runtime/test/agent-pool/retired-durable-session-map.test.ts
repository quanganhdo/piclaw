import "../helpers.js";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { AgentRuntimeFacade, type AgentRuntimeFacadeOptions } from "../../src/agent-pool/runtime-facade.js";
import type { DurableSessionPositionPort } from "../../src/agent-pool/durable-runtime-adapter.js";
import { createTestModelRuntime } from "../model-services-fixture.js";

function options(): AgentRuntimeFacadeOptions {
  const modelRuntime = createTestModelRuntime();
  return { pool: new Map(), modelRuntime, modelRegistry: new ModelRegistry(modelRuntime),
    authPath: join(process.env.PICLAW_WORKSPACE!, "unused-auth.json") };
}

for (const value of [undefined, new Map(), new Map([["native", { sessionId: "old", branchId: "main", readPosition: async () => null }]])]) {
  test(`retired map input is rejected before live lookup or legacy side effects: ${value === undefined ? "undefined" : value.size}`, () => {
    let reads = 0;
    const input = { ...options(), durableSessions: value,
      get getDurableSession() { reads++; return () => undefined; } };
    expect(() => new AgentRuntimeFacade(input)).toThrow("durableSessions is retired; use getDurableSession");
    expect(reads).toBe(0);
  });
}

test("retirement refuses the map without evaluating its iterator", () => {
  let iterations = 0;
  const map = new Map<string, DurableSessionPositionPort>();
  Object.defineProperty(map, Symbol.iterator, { value() { iterations++; throw Error("retired map iterator entered"); } });
  const input = { ...options(), durableSessions: map };
  expect(() => new AgentRuntimeFacade(input)).toThrow("durableSessions is retired; use getDurableSession");
  expect(iterations).toBe(0);
});

const methods = ["readPosition", "readContextUsage", "readModel", "readThinkingLevel", "setThinkingLevel", "setModel", "reset",
  "readAbortScope", "abort", "abortRetry", "restart", "runBash", "abortBash", "readExecutionPolicy", "setExecutionPolicy",
  "requestExit", "compact", "reconcileMaintenance", "readTree", "readMetadata", "readReport", "assertCurrent", "runOwnedControl"] as const;
for (const method of methods) {
  test(`the supported lookup still validates callable ${method}`, () => {
    const port = { sessionId: "native", branchId: "main", readPosition: async () => null, [method]: 123 } as unknown as DurableSessionPositionPort;
    const facade = new AgentRuntimeFacade({ ...options(), getDurableSession: () => port });
    expect(() => facade.getSessionGenerationForChat("native")).toThrow(`Durable runtime ${method} must be callable`);
  });
}

test("lookup callback and mode are captured, receiver-owned routing stays live", async () => {
  const first = Object.freeze({ sessionId: "first", branchId: "main", async readPosition() { return this.sessionId; } });
  const next = Object.freeze({ sessionId: "next", branchId: "main", async readPosition() { return this.sessionId; } });
  const input = { ...options(), route: first as DurableSessionPositionPort,
    getDurableSession(chat: string) { return chat === "native" ? this.route : undefined; } };
  const facade = new AgentRuntimeFacade(input);
  input.getDurableSession = () => { throw Error("replaced lookup entered"); };
  expect(await facade.saveSessionPosition("native")).toBe("first");
  input.route = next;
  expect(await facade.saveSessionPosition("native")).toBe("next");
  Reflect.set(input, "getDurableSession", undefined);
  input.pool.set("legacy", { lastUsed: 0, get runtime(): never { throw Error("legacy fallback entered"); } });
  await expect(facade.getContextUsageForChat("legacy")).rejects.toThrow("Durable application does not construct legacy sessions");
  await expect(facade.saveSessionPosition("unknown")).rejects.toThrow("Durable session position unavailable");
});

test("no snapshot-map validator or method-rebinding factory remains", () => {
  const source = readFileSync(join(import.meta.dir, "../../src/agent-pool/runtime-facade.ts"), "utf8");
  expect(source).not.toContain("const bindCompatibilityMethod");
  expect(source).not.toContain("const compatibility = options.durableSessions");
});
