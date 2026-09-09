import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "bun:sqlite";

import { initializeAccessSchema, readAccessState, validateAccessStartup } from "../../src/db/access-state.js";
import { promotePreparedFamilyDatabase } from "../../src/db/access-migration-promotion.js";

const runtimeRoot = resolve(import.meta.dir, "../..");

test("startup gate runs before add-ons, environment hooks, workers and listeners", () => {
  const source = readFileSync(join(runtimeRoot, "src/runtime/startup.ts"), "utf8");
  const gate = source.indexOf("validateAccessStartup(getDb())");
  expect(gate).toBeGreaterThan(source.indexOf("  initDatabase();"));
  for (const later of ["installAddonRuntimeApi();", "  applyEnvironmentOverrides();", "  startExternalProgressWatchdogMonitor();", "  launchWorkspaceIndexProcess({"]) {
    expect(source.indexOf(later)).toBeGreaterThan(gate);
  }
});

test("runtime startup rejects an unpromoted family store before starting add-on API", async () => {
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

test("promoted family startup is accepted only with matching explicit configuration", async () => {
  const dir=mkdtempSync(join(tmpdir(),'piclaw-family-promoted-')),path=join(dir,'messages.db'),configPath=join(dir,'config.json');let db=new Database(path);
  try {
    initializeAccessSchema(db);db.exec(`CREATE TABLE chats(jid TEXT PRIMARY KEY);CREATE TABLE chat_branches(branch_id TEXT PRIMARY KEY,chat_jid TEXT,root_chat_jid TEXT,parent_branch_id TEXT,agent_name TEXT,handle_owner_id TEXT,archived_at TEXT);
      CREATE TABLE session_roots(root_branch_id TEXT PRIMARY KEY,owner_user_id TEXT,policy TEXT);CREATE TABLE migration_input_holds(message_rowid INTEGER,source_snapshot TEXT);
      CREATE TABLE access_input_migration(id INTEGER PRIMARY KEY,source_snapshot TEXT,policy TEXT,held_inputs INTEGER,prepared_at TEXT);
      CREATE TABLE owned_fork_operations(seed_json TEXT);CREATE TABLE access_resource_migration(id INTEGER PRIMARY KEY,policy TEXT,source_snapshot TEXT);
      CREATE TABLE access_factor_migration(id INTEGER PRIMARY KEY,source_snapshot TEXT,policy_json TEXT);
      CREATE TABLE access_migration_preparation(id INTEGER PRIMARY KEY,source_snapshot TEXT,plan_version INTEGER,prepared_at TEXT,state TEXT,children_pending INTEGER,children_adopted INTEGER,resource_policy TEXT,factor_policy_json TEXT,input_policy TEXT);`);
    const snapshot='a'.repeat(64),now=new Date().toISOString(),factor=JSON.stringify({passkeys:'preserve-immutable-handles',legacy_totp:'none'});
    db.exec(`INSERT INTO chats VALUES ('web:default');INSERT INTO chat_branches VALUES ('default','web:default','web:default',NULL,'default','default',NULL);INSERT INTO session_roots VALUES ('default','default','private');UPDATE users SET home_chat_jid='web:default';`);
    db.query('INSERT INTO access_resource_migration VALUES (1,?,?)').run('revoke-logins-pause-tasks-quarantine-media-v1',snapshot);db.query('INSERT INTO access_factor_migration VALUES (1,?,?)').run(snapshot,factor);db.query('INSERT INTO access_input_migration VALUES (1,?,?,0,?)').run(snapshot,'hold-legacy-inputs-owner-dismiss-v1',now);db.query("INSERT INTO access_migration_preparation VALUES (1,?,5,?,'ownership-only',0,0,?,?,?)").run(snapshot,now,'revoke-logins-pause-tasks-quarantine-media-v1',factor,'hold-legacy-inputs-owner-dismiss-v1');
    promotePreparedFamilyDatabase(db);writeFileSync(configPath,JSON.stringify({domains:{access:{mode:'family-shared'}}}));
    expect(validateAccessStartup(db,configPath)).toEqual({configuredMode:'family-shared',effectiveMode:'family-shared',modeExplicit:true});
    expect(()=>validateAccessStartup(db,join(dir,'missing.json'))).toThrow('no automatic downgrade');
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
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
