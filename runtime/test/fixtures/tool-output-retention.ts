import { expect, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../src/db.js";
import * as output from "../../src/tool-output.js";
import * as accessConfig from "../../src/core/config-access.js";

const workspace = process.env.PICLAW_WORKSPACE!, data = process.env.PICLAW_DATA!;
function configure(mode: "single-user" | "family-shared" | "invalid") {
  writeFileSync(join(workspace, ".piclaw/config.json"), mode === "invalid" ? "{" : JSON.stringify({ domains: { access: { mode } } }));
}
function disk(root: string): unknown[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map((e) => [e.name, e.isDirectory() ? disk(join(root, e.name)) : readFileSync(join(root, e.name)).toString("base64")]);
}
function snapshot() {
  return JSON.stringify({ metadata: getDb().query("SELECT * FROM tool_outputs ORDER BY id").all(), fts: getDb().query("SELECT * FROM tool_outputs_fts ORDER BY rowid").all(), files: disk(join(data, "tool-output")) });
}
export async function runScenario(scenario: string) {
  mkdirSync(join(workspace, ".piclaw"), { recursive: true }); configure("single-user"); initDatabase();
  const callbacks: Array<() => void> = [], cleared: unknown[] = [];
  const interval = spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void) => { callbacks.push(fn); return { unref() {} } as any; }) as any);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation(((timer: any) => { cleared.push(timer); }) as any);
  try {
    if (scenario === "stop-restart") {
      configure("family-shared"); output.startToolOutputCleanup(); expect(callbacks).toHaveLength(0);
      configure("single-user"); output.startToolOutputCleanup(); expect(callbacks).toHaveLength(1);
      output.saveToolOutput("retained", { createdAt: "2000-01-01T00:00:00.000Z" }); const before = snapshot();
      configure("invalid"); callbacks[0](); expect(snapshot()).toBe(before); expect(cleared).toHaveLength(1);
      configure("single-user"); output.startToolOutputCleanup(); expect(callbacks).toHaveLength(2);
      expect((getDb().query("SELECT count(*) n FROM tool_outputs").get() as any).n).toBe(0);
      configure("family-shared"); callbacks[1](); expect(cleared).toHaveLength(2);
    } else if (scenario === "check-race") {
      const original = accessConfig.readAccessConfig; let reads = 0, denyAt = 2;
      const configSpy = spyOn(accessConfig, "readAccessConfig").mockImplementation((path) => {
        if (++reads === denyAt) configure("family-shared"); return original(path);
      });
      try {
        const before = snapshot();
        expect(() => output.startToolOutputCleanup()).not.toThrow(); expect(callbacks).toHaveLength(0); expect(snapshot()).toBe(before);
        configure("single-user"); denyAt = Infinity; output.startToolOutputCleanup(); expect(callbacks).toHaveLength(1);
        const beforeTick = snapshot(); reads = 0; denyAt = 2;
        expect(callbacks[0]).not.toThrow(); expect(snapshot()).toBe(beforeTick); expect(cleared).toHaveLength(1);
        configure("single-user"); denyAt = Infinity; output.startToolOutputCleanup(); expect(callbacks).toHaveLength(2);
      } finally { configSpy.mockRestore(); }
    } else throw Error(`Unknown scenario: ${scenario}`);
  } finally { configure("family-shared"); callbacks.at(-1)?.(); clear.mockRestore(); interval.mockRestore(); closeDatabase(); }
  console.log(`RETENTION_OK:${scenario}`);
}
