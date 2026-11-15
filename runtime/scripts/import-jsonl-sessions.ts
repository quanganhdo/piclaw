#!/usr/bin/env bun
// Explicit archive-layout tooling only; never native execution persistence.
import Database from "bun:sqlite";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { SqliteSessionStore, inspectSessionStore } from "./lib/sqlite-session-archive.js";
import { createVerifiedSqliteBackup } from "../src/db/backup.js";

interface Options {
  source: string;
  target: string;
  layout: "unified" | "separate";
  dryRun: boolean;
  limit: number | null;
}

function usage(): never {
  throw new Error("Usage: import-jsonl-sessions.ts --source <file-or-dir> --target <sqlite> --layout <unified|separate> [--dry-run] [--limit N]");
}

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!arg.startsWith("--") || !args[index + 1]) usage();
    values.set(arg, args[++index]);
  }
  const source = values.get("--source");
  const target = values.get("--target");
  const layout = values.get("--layout");
  if (!source || !target || (layout !== "unified" && layout !== "separate")) usage();
  const limitValue = values.get("--limit");
  const limit = limitValue === undefined ? null : Number(limitValue);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) usage();
  return { source: resolve(source), target: resolve(target), layout, dryRun, limit };
}

function collectJsonl(path: string): string[] {
  const stat = lstatSync(path);
  if (stat.isFile()) return path.endsWith(".jsonl") ? [realpathSync(path)] : [];
  if (!stat.isDirectory()) return [];
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const child = join(dir, name);
      const childStat = lstatSync(child);
      if (childStat.isSymbolicLink()) continue;
      if (childStat.isDirectory()) visit(child);
      else if (childStat.isFile() && name.endsWith(".jsonl")) files.push(realpathSync(child));
    }
  };
  visit(path);
  return files;
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-");
}

const options = parseArgs(process.argv.slice(2));
if (options.layout === "unified") {
  throw new Error("Unified imports are intentionally unsupported; the selected architecture requires a dedicated sessions.db.");
}
const files = collectJsonl(options.source).slice(0, options.limit ?? Number.POSITIVE_INFINITY);
if (files.length === 0) throw new Error(`No JSONL session files found under ${options.source}`);
if (files.some((file) => resolve(file) === options.target)) throw new Error("SQLite target cannot be one of the JSONL sources.");
if (existsSync(options.target)) {
  const existing = new Database(options.target, { readonly: true, strict: true });
  try {
    const unrelated = existing.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'piclaw_agent_%'
        AND name != 'piclaw_schema_migrations'
      ORDER BY name LIMIT 1
    `).get() as { name?: string } | undefined;
    if (unrelated?.name) throw new Error(`Separate session target contains unrelated table: ${unrelated.name}`);
  } finally {
    existing.close();
  }
}

const sourceBytes = files.reduce((total, file) => total + statSync(file).size, 0);
const report: Record<string, unknown> = {
  version: 1,
  mode: options.dryRun ? "dry-run" : "import",
  layout: options.layout,
  source: options.source,
  target: options.target,
  sourceFiles: files.length,
  sourceBytes,
  sourcesPreserved: true,
  startedAt: new Date().toISOString(),
};

if (options.dryRun) {
  report.files = files;
  report.completedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

mkdirSync(dirname(options.target), { recursive: true });
if (existsSync(options.target)) {
  const backupPath = `${options.target}.pre-session-import-${timestamp()}.backup`;
  const source = new Database(options.target, { strict: true });
  try {
    report.backup = createVerifiedSqliteBackup(source, options.target, backupPath);
  } finally {
    source.close();
  }
}

const store = new SqliteSessionStore(options.target);
let imported = 0;
let alreadyImported = 0;
let entries = 0;
try {
  for (const file of files) {
    const result = await store.importJsonl(file);
    entries += result.entryCount;
    if (result.imported) imported += 1;
    else alreadyImported += 1;
    const roundTrip = store.verifyRoundTrip(result.importId);
    if (!roundTrip.matches) throw new Error(`Round-trip verification failed: ${file}`);
  }
} finally {
  store.close();
}

report.imported = imported;
report.alreadyImported = alreadyImported;
report.entries = entries;
report.database = inspectSessionStore(options.target);
report.completedAt = new Date().toISOString();
const manifestPath = `${options.target}.session-import-${timestamp()}.json`;
writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ...report, manifestPath, targetName: basename(options.target) }, null, 2));
