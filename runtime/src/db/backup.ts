import Database, { constants } from "bun:sqlite";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, linkSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface SqliteBackupManifest {
  sourcePath: string;
  destinationPath: string;
  createdAt: string;
  /** Bound source main-file size at admission; excludes its WAL. */
  sourceBytes: number;
  backupBytes: number;
  integrityCheck: string;
  applicationId: number;
  userVersion: number;
  tableCount: number;
  indexCount: number;
  triggerCount: number;
  viewCount: number;
  /** Evidence from the snapshot, not proof of a complete external recovery unit. */
  migrationLedgers: Record<string, { rowCount: number; sha256: string }>;
}

function pragmaNumber(database: Database, pragma: "application_id" | "user_version"): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
  const value = row?.[pragma];
  return typeof value === "bigint" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function schemaCounts(database: Database): Pick<SqliteBackupManifest, "tableCount" | "indexCount" | "triggerCount" | "viewCount"> {
  const rows = database.prepare(`
    SELECT type, COUNT(*) AS count
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    GROUP BY type
  `).all() as Array<{ type: string; count: number | bigint }>;
  const counts = new Map(rows.map((row) => [row.type, Number(row.count)]));
  return {
    tableCount: counts.get("table") ?? 0,
    indexCount: counts.get("index") ?? 0,
    triggerCount: counts.get("trigger") ?? 0,
    viewCount: counts.get("view") ?? 0,
  };
}

function migrationLedgers(database: Database): SqliteBackupManifest["migrationLedgers"] {
  const result: SqliteBackupManifest["migrationLedgers"] = {};
  for (const table of ["durable_schema", "durable_metadata", "piclaw_schema_migrations", "core_schema_migrations"]) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    const rows = database.prepare(`SELECT * FROM "${table}"`).values().map(row =>
      JSON.stringify(row, (_key, value) => {
        if (typeof value === "bigint") return { integer: String(value) };
        if (value instanceof Uint8Array) return { blob: Buffer.from(value).toString("hex") };
        if (typeof value === "number" && !Number.isFinite(value)) return { real: String(value) };
        return value;
      })).sort();
    result[table] = { rowCount: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }
  return result;
}

export function verifySqliteBackup(path: string): Omit<SqliteBackupManifest, "sourcePath" | "destinationPath" | "createdAt" | "sourceBytes"> {
  const database = new Database(path, { readonly: true, strict: true, safeIntegers: true });
  try {
    // Also keep standalone verification coherent if another connection writes.
    database.exec("BEGIN");
    const integrityRow = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    const integrityCheck = String(integrityRow?.integrity_check ?? "");
    if (integrityCheck !== "ok") throw new Error(`SQLite backup integrity check failed: ${integrityCheck || "no result"}`);
    return {
      backupBytes: statSync(path).size,
      integrityCheck,
      applicationId: pragmaNumber(database, "application_id"),
      userVersion: pragmaNumber(database, "user_version"),
      ...schemaCounts(database),
      migrationLedgers: migrationLedgers(database),
    };
  } finally {
    // End the owned snapshot explicitly: close can defer releasing SQLite until
    // prepared statements are collected, otherwise a verified file stays locked.
    try { if (database.inTransaction) database.exec("ROLLBACK"); }
    finally { database.close(); }
  }
}

function bindSource(source: Database, path: string) {
  const main = (source.prepare("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main");
  if (!main?.file || realpathSync(main.file) !== realpathSync(path)) throw new Error("SQLite backup requires the bound file-backed main database.");
  const identity = statSync(path);
  const assertCurrent = () => {
    const moved = new Int32Array(2);
    // The VFS checks the open SQLite descriptor too, detecting replacement
    // before this call; merely statting the supplied filename cannot do that.
    const code = source.fileControl("main", constants.SQLITE_FCNTL_HAS_MOVED, moved);
    const current = statSync(path);
    if (code !== 0 /* SQLITE_OK */ || moved[0] !== 0 || !current.isFile() ||
        current.dev !== identity.dev || current.ino !== identity.ino || realpathSync(main.file) !== realpathSync(path))
      throw new Error("SQLite backup source binding changed.");
  };
  assertCurrent();
  return { sourceBytes: identity.size, assertCurrent };
}

/**
 * Capture committed WAL data into an exclusively owned private staging file.
 * Verify and sync that snapshot before atomic no-clobber hard-link publication.
 * Cleanup never removes the requested destination. The source remains caller-owned.
 */
export function createVerifiedSqliteBackup(
  source: Database,
  sourcePath: string,
  destinationPath: string,
): SqliteBackupManifest {
  const sourceResolved = resolve(sourcePath);
  const destinationResolved = resolve(destinationPath);
  if (sourceResolved === destinationResolved) throw new Error("SQLite backup destination must differ from source.");
  if (existsSync(destinationResolved)) throw new Error(`SQLite backup destination already exists: ${destinationResolved}`);
  const binding = bindSource(source, sourceResolved);
  const parent = dirname(destinationResolved);
  mkdirSync(parent, { recursive: true });
  // Same filesystem as the final name, with no shared temporary filename.
  const staging = mkdtempSync(join(parent, ".sqlite-backup-"));
  const temporary = join(staging, "snapshot.db");
  let descriptor: number | undefined;
  try {
    // SQLite accepts an existing empty VACUUM INTO target. Keep this owned
    // descriptor open so the verified file is synced before its name is published.
    descriptor = openSync(temporary, "wx", 0o600);
    binding.assertCurrent();
    source.prepare("VACUUM INTO ?").run(temporary);
    binding.assertCurrent();
    const verified = verifySqliteBackup(temporary);
    fsyncSync(descriptor);
    const manifest = {
      sourcePath: sourceResolved,
      destinationPath: destinationResolved,
      createdAt: new Date().toISOString(),
      sourceBytes: binding.sourceBytes,
      ...verified,
    };
    binding.assertCurrent();
    const owned = fstatSync(descriptor);
    const staged = statSync(temporary);
    if (owned.dev !== staged.dev || owned.ino !== staged.ino || staged.size !== verified.backupBytes)
      throw new Error("SQLite backup staging identity changed.");
    // link fails on every existing destination, including an empty file or a
    // dangling symlink. Never fall back to an overwriting rename/copy.
    linkSync(temporary, destinationResolved);
    const directory = openSync(parent, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return manifest;
  } finally {
    try { if (descriptor !== undefined) closeSync(descriptor); }
    finally { rmSync(staging, { recursive: true, force: true }); }
  }
}
