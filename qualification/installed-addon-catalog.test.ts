import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "../runtime/src/durable-legacy-sdk.js";
import { loadApplicationExtensionCatalog, qualifyInstalledAddon, applicationAddonSourceProfiles, assertApplicationExtensionCatalogSupported, assertInstalledNativeExports } from "../runtime/durable-engine/src/host-extension-catalog.ts";
import { installedAddonProfiles } from "../runtime/durable-engine/src/host-installed-addon-profiles.ts";

for (const name of ["unknown", "proxmox"]) test(`${name} unqualified installed source rejected BEFORE evaluation, including repeated loads`, async () => {
  const cwd = mkdtempSync(join(import.meta.dir, ".qualification-catalog-"));
  try {
    const pkg = join(cwd, ".pi/extensions/node_modules/@rcarmo", `piclaw-addon-${name}`);
    const agentDir = join(cwd, "agent");
    mkdirSync(pkg, { recursive: true }); mkdirSync(agentDir);
    const marker = join(cwd, "EXECUTED");
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: `@rcarmo/piclaw-addon-${name}`, version: name === "proxmox" ? installedAddonProfiles.proxmox.version : "1.0.0", type: "module", pi: { extensions: ["index.ts"] } }));
    writeFileSync(join(pkg, "index.ts"), `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "unsafe"); export default function() {}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(loadApplicationExtensionCatalog({ cwd, agentDir, settingsManager: SettingsManager.inMemory() })).rejects.toThrow(/before evaluation|cache provenance/);
      expect(existsSync(marker)).toBe(false);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("candidate catalog explicitly inventories fourteen additions without claiming native binding", () => {
  expect(Object.keys(installedAddonProfiles)).toHaveLength(14);
  expect(installedAddonProfiles["codex-conversion"].nativeExports["src/native-provider.ts"]).toContain("bindNativeCodexProvider");
  for (const profile of Object.values(installedAddonProfiles)) {
    expect(profile.files["package.json"]).toMatch(/^[a-f0-9]{64}$/);
    for (const file of Object.keys(profile.nativeExports)) expect(file in profile.files).toBe(true);
    for (const file of Object.keys(profile.files).filter(file => file.endsWith(".ts"))) expect(profile.shadows).toContain(file.replace(/\.ts$/, ".js"));
    for (const path of profile.skillPaths) expect(path.startsWith("skills/")).toBe(true);
  }
  expect(typeof qualifyInstalledAddon).toBe("function");
});

test("exact static fixture qualification is source-bound; mutation and cache reuse fail closed", async () => {
  const root = process.env.DURABLE_ADDONS_ROOT;
  if (!root) throw Error("DURABLE_ADDONS_ROOT must name candidate source tree, never live installed packages");
  const cwd = mkdtempSync(join(import.meta.dir, ".qualification-catalog-"));
  try {
    const profile = installedAddonProfiles["yolo-vibe"];
    const pkg = join(cwd, ".pi/extensions/node_modules", profile.name);
    const agentDir = join(cwd, "agent");
    mkdirSync(pkg, { recursive: true }); mkdirSync(agentDir);
    for (const file of Object.keys(profile.files)) {
      const target = join(pkg, file);
      mkdirSync(join(target, ".."), { recursive: true });
      copyFileSync(join(root, "addons/yolo-vibe", file), target);
    }
    const options = { cwd, agentDir, settingsManager: SettingsManager.inMemory() };
    const catalog = await loadApplicationExtensionCatalog(options);
    expect(catalog.errors).toEqual([]);
    const qualified = await qualifyInstalledAddon(catalog, cwd, "yolo-vibe");
    expect(qualified?.capabilities.nativeBinding).toBe("unbound");
    qualified!.assertCurrent();
    const path = join(pkg, "index.ts");
    const bytes = readFileSync(path);
    writeFileSync(path, Buffer.concat([bytes, Buffer.from("\n// changed fixture\n")]));
    expect(() => qualified!.assertCurrent()).toThrow("source changed");
    await expect(loadApplicationExtensionCatalog(options)).rejects.toThrow("cache provenance");
    writeFileSync(path, bytes);
    qualified!.assertCurrent();
    const shadow = join(pkg, "index.js");
    writeFileSync(shadow, "throw Error('must never evaluate shadow')");
    expect(() => qualified!.assertCurrent()).toThrow("source changed");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("dashboard projection uses only the explicit owned Root handle and revokes", async () => {
  const root = process.env.DURABLE_ADDONS_ROOT;
  if (!root) throw Error("DURABLE_ADDONS_ROOT candidate tree required");
  const cwd = mkdtempSync(join(import.meta.dir, ".qualification-catalog-"));
  const db = new Database(":memory:");
  try {
    const profile = installedAddonProfiles["session-dashboard"];
    const pkg = join(cwd, ".pi/extensions/node_modules", profile.name);
    const agentDir = join(cwd, "agent");
    mkdirSync(pkg, { recursive: true }); mkdirSync(agentDir);
    for (const file of Object.keys(profile.files)) copyFileSync(join(root, "addons/session-dashboard", file), join(pkg, file));
    db.exec(`CREATE TABLE messages(chat_jid TEXT, timestamp TEXT, content TEXT, content_blocks TEXT, is_bot_message INTEGER, is_terminal_agent_reply INTEGER, sender TEXT);
      CREATE TABLE chat_branches(chat_jid TEXT, agent_name TEXT, root_chat_jid TEXT, branch_id TEXT, archived_at TEXT);
      INSERT INTO messages VALUES ('web:owned', '2026-01-01', 'Owned projection', NULL, 1, 1, 'assistant');`);
    const catalog = await loadApplicationExtensionCatalog({ cwd, agentDir, settingsManager: SettingsManager.inMemory() });
    const qualified = await qualifyInstalledAddon(catalog, cwd, "session-dashboard");
    const bind = qualified!.nativeExports["index.ts"]!.bindSessionDashboardProjection as (db: Database, assertCurrent: () => void) => { get(payload: unknown, req: Request): Promise<{ sessions: { chat_jid: string }[] }> };
    let active = true;
    const projection = bind(db, () => { if (!active) throw Error("revoked"); });
    expect((await projection.get({}, new Request("https://fixture.test/"))).sessions.map(row => row.chat_jid)).toEqual(["web:owned"]);
    active = false;
    await expect(projection.get({}, new Request("https://fixture.test/"))).rejects.toThrow("revoked");
    expect(db.query("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 1 });
  } finally { db.close(); rmSync(cwd, { recursive: true, force: true }); }
});


test("full 23 installed-package parity: exact source, all fourteen export receipts, no new binding exemptions", async () => {
  const root = process.env.DURABLE_ADDONS_ROOT;
  if (!root) throw Error("DURABLE_ADDONS_ROOT candidate source tree required");
  const cwd = mkdtempSync(join(import.meta.dir, ".qualification-catalog-"));
  try {
    const agentDir = join(cwd, "agent"); mkdirSync(agentDir);
    symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "dir");
    const dependencyRoot = process.env.DURABLE_CATALOG_DEPENDENCIES;
    expect(Object.keys(applicationAddonSourceProfiles)).toHaveLength(23);
    for (const [kind, profile] of Object.entries(applicationAddonSourceProfiles)) {
      const slug = profile.name.replace("@rcarmo/piclaw-addon-", "");
      const pkg = join(cwd, ".pi/extensions/node_modules", kind === "eml-viewer" ? "piclaw-addon-eml-viewer" : profile.name);
      for (const file of new Set(["package.json", ...Object.keys(profile.files)])) {
        const target = join(pkg, file); mkdirSync(join(target, ".."), { recursive: true });
        copyFileSync(join(root, "addons", slug, file), target);
      }
      // Public fixture dependencies only; unresolved SDK/Core imports retain the candidate Root identity.
      if (dependencyRoot) symlinkSync(dependencyRoot, join(pkg, "node_modules"), "dir");
    }
    const options = { cwd, agentDir, settingsManager: SettingsManager.inMemory() };
    const catalog = await loadApplicationExtensionCatalog(options);
    expect(catalog.errors).toEqual([]);
    expect(catalog.extensions).toHaveLength(21); // two skill-only packages
    for (const kind of Object.keys(installedAddonProfiles) as (keyof typeof installedAddonProfiles)[]) {
      const receipt = await qualifyInstalledAddon(catalog, cwd, kind);
      expect(receipt).toBeDefined(); receipt!.assertCurrent();
      expect(receipt!.capabilities.nativeBinding).toBe("unbound");
      for (const [file, names] of Object.entries(installedAddonProfiles[kind].nativeExports))
        for (const name of names) expect(typeof receipt!.nativeExports[file]![name]).toBe("function");
    }
    expect(() => assertApplicationExtensionCatalogSupported(catalog)).toThrow("native capabilities require explicit application binding");
    // Registration tampering cannot be turned into a fresh source receipt.
    const receipt = await qualifyInstalledAddon(catalog, cwd, "proxmox");
    receipt!.extension!.tools.clear();
    expect(() => receipt!.assertCurrent()).toThrow("capabilities changed");
    await expect(qualifyInstalledAddon(catalog, cwd, "proxmox")).rejects.toThrow("capabilities changed");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});


test("missing native factories are not inferred from legacy declarations", () => {
  expect(() => assertInstalledNativeExports({ default() {} }, ["createProxmoxTool"], "proxmox")).toThrow("native exports required");
  expect(() => assertInstalledNativeExports({ createProxmoxTool: {} }, ["createProxmoxTool"], "proxmox")).toThrow("native exports required");
});
