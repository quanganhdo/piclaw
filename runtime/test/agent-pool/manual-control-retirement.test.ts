import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentPool } from "../../src/agent-pool.js";
import { AgentRuntimeFacade } from "../../src/agent-pool/runtime-facade.js";
import "../helpers.js";

const source = resolve(import.meta.dir, "../../src");
const retired = [
  "agent-pool/compaction.ts", "session-rotation.ts", "agent-pool/context-pressure-retry.ts",
  "agent-pool/slash-command.ts", "agent-pool/prompt-utils.ts", "agent-control/handlers/control.ts", "agent-control/handlers/session.ts",
  "agent-control/handlers/queue.ts", "agent-control/handlers/model.ts",
];

test("legacy manual compaction, rotation and prompt-control implementations are absent", () => {
  expect(retired.filter(file => existsSync(resolve(source, file)))).toEqual([]);
  expect("emergencyRotateSession" in AgentPool.prototype).toBe(false);
  expect("applySlashCommand" in AgentRuntimeFacade.prototype).toBe(false);
  const dispatcher = readFileSync(resolve(source, "agent-control/agent-control-handlers.ts"), "utf8");
  expect(dispatcher).not.toContain("export async function applyControlCommand(");
});

test("missing native control authority cannot hydrate, mutate or compact a legacy runtime", async () => {
  let legacyCalls = 0;
  const forbidden = () => { legacyCalls++; throw Error("legacy runtime entered"); };
  const facade = new AgentRuntimeFacade({
    pool: new Map(), modelRegistry: {} as any, modelRuntime: {} as any, authPath: "unused",
    // Deliberately offer the old caller shape: it must confer no execution authority.
    getOrCreateRuntime: forbidden, refreshRuntime: forbidden, clearAttachments: forbidden,
  } as any);
  for (const type of ["compact", "session_rotate", "new_session", "model", "thinking", "tree", "bash", "auto_compact", "auto_retry", "abort"] as const) {
    await expect(facade.applyControlCommand("web:unbound", { type, raw: "/" + type } as any))
      .resolves.toMatchObject({ status: "error", message: expect.stringContaining("Native control binding unavailable") });
  }
  await expect(facade.getCurrentModelLabel("web:unbound")).rejects.toThrow("Durable session model unavailable");
  await expect(facade.getSessionTreeForChat("web:unbound")).rejects.toThrow("Durable session tree unavailable");
  await expect(facade.saveSessionPosition("web:unbound")).rejects.toThrow("Durable session position unavailable");
  expect(facade).not.toHaveProperty("restoreSessionPosition");
  expect(legacyCalls).toBe(0);
});
