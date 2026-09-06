import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "bun:sqlite";

import { initializeAccessSchema, readAccessState, validateAccessStartup } from "../../src/db/access-state.js";

const runtimeRoot = resolve(import.meta.dir, "../..");

test("startup gate runs before add-ons, environment hooks, workers and listeners", () => {
  const source = readFileSync(join(runtimeRoot, "src/runtime/startup.ts"), "utf8");
  const gate = source.indexOf("validateAccessStartup(getDb())");
  expect(gate).toBeGreaterThan(source.indexOf("  initDatabase();"));
  for (const later of ["  installAddonRuntimeApi();", "  applyEnvironmentOverrides();", "  startExternalProgressWatchdogMonitor();", "  launchWorkspaceIndexProcess({"]) {
    expect(source.indexOf(later)).toBeGreaterThan(gate);
  }
});

test("runtime startup rejects unimplemented family mode before starting add-on API", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "piclaw-family-startup-"));
  try {
    mkdirSync(join(workspace, ".piclaw"));
    writeFileSync(join(workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
    const proc = Bun.spawn([process.execPath, "-e", `
      const { initializeRuntimeEnvironment } = await import('./src/runtime/startup.ts');
      const { RuntimeState } = await import('./src/runtime/state.ts');
      try { initializeRuntimeEnvironment(new RuntimeState(process.env.PICLAW_DATA)); process.exit(2); }
      catch (error) {
        console.error(String(error));
        if (globalThis.__piclaw_addon_api) process.exit(3);
        process.exit(String(error).includes('Access mode mismatch') ? 0 : 4);
      }
    `], {
      cwd: runtimeRoot,
      env: { ...process.env, PICLAW_WORKSPACE: workspace, PICLAW_STORE: join(workspace,".piclaw/store"), PICLAW_DATA: join(workspace,".piclaw/data"), PICLAW_DB_IN_MEMORY: "1", PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
    expect(stderr).toContain("Access mode mismatch");
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("disk activation state survives reopen and rejects lost configuration without changing credentials", () => {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-access-reopen-"));
  const path = join(dir, "messages.db");
  let db = new Database(path);
  try {
    db.exec(`CREATE TABLE web_sessions(token TEXT PRIMARY KEY, user_id TEXT); INSERT INTO web_sessions VALUES ('hash','default');
      CREATE TABLE webauthn_credentials(credential_id TEXT PRIMARY KEY,user_id TEXT); INSERT INTO webauthn_credentials VALUES ('credential','default');`);
    initializeAccessSchema(db);
    db.exec("UPDATE access_state SET activated_mode='family-shared'");
    db.close(); db = new Database(path);
    initializeAccessSchema(db);
    expect(() => validateAccessStartup(db, join(dir, "missing.json"))).toThrow("no automatic downgrade");
    expect(readAccessState(db).activatedMode).toBe("family-shared");
    expect(db.query("SELECT * FROM web_sessions").all()).toEqual([{ token: "hash", user_id: "default" }]);
    expect(db.query("SELECT * FROM webauthn_credentials").all()).toEqual([{ credential_id: "credential", user_id: "default" }]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
