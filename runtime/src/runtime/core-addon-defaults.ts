import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const hostPeers = new Set(["typebox", "@sinclair/typebox", "@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]);
const require = createRequire(import.meta.url);

function entryExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** Seed release-pinned add-ons only before a workspace has ever been started. */
export function seedFreshWorkspaceCoreAddons(workspaceDir: string, storeDir: string, skelDir: string): boolean {
  const source = join(skelDir, ".piclaw", "core-addons", "defaults");
  const target = join(workspaceDir, ".pi", "extensions");
  if (!existsSync(source) || entryExists(target) || entryExists(join(storeDir, "messages.db"))) return false;
  const manifest = JSON.parse(readFileSync(join(source, "core-addons.lock.json"), "utf8")) as {
    schemaVersion: number;
    addons: Array<{ name: string; version: string }>;
  };
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.addons) || !manifest.addons.length) throw new Error("Invalid bundled core add-ons");
  const peers = new Set<string>();
  for (const addon of manifest.addons) {
    if (!/^@rcarmo\/piclaw-addon-[a-z0-9-]+$/.test(addon.name) || !/^\d+\.\d+\.\d+$/.test(addon.version)) throw new Error("Invalid bundled core add-on entry");
    const installed = JSON.parse(readFileSync(join(source, "node_modules", addon.name, "package.json"), "utf8")) as { name?: string; version?: string; peerDependencies?: Record<string, string> };
    if (installed.name !== addon.name || installed.version !== addon.version) throw new Error(`Bundled core add-on mismatch: ${addon.name}`);
    for (const peer of Object.keys(installed.peerDependencies ?? {})) if (hostPeers.has(peer)) peers.add(peer);
  }
  mkdirSync(dirname(target), { recursive: true });
  const lock = `${target}.seed-lock`;
  // Coordinate seed publishers without replacing an existing target directory
  // (Windows cannot rename over an empty reserved target).
  try { mkdirSync(lock); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  let staging: string | undefined;
  try {
    if (entryExists(target) || entryExists(join(storeDir, "messages.db"))) return false;
    staging = mkdtempSync(`${target}.seed-`);
    cpSync(source, staging, { recursive: true });
    // Offline bundles omit host peers. Workspace copies cannot resolve peers
    // beside the installed runtime, so share that exact host package instance.
    for (const peer of peers) {
      const destination = join(staging, "node_modules", peer);
      if (existsSync(destination)) continue;
      const packageDir = dirname(require.resolve(`${peer}/package.json`));
      mkdirSync(dirname(destination), { recursive: true });
      symlinkSync(packageDir, destination, process.platform === "win32" ? "junction" : "dir");
    }
    if (entryExists(target) || entryExists(join(storeDir, "messages.db"))) return false;
    renameSync(staging, target);
    return true;
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
    rmdirSync(lock);
  }
}
