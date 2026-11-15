import Database from "bun:sqlite";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, fsyncSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createVerifiedSqliteBackup } from "../../src/db/backup.js";
import { applyHistoricalAccounts, historicalAccountMigration, inspectHistoricalAccounts, snapshotHistoricalDatabase } from "./historical-account-retirement.js";

const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function privateDirectory(path: string): string {
  const directory = resolve(path), info = lstatSync(directory);
  if (!info.isDirectory() || realpathSync(directory) !== directory || (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())) throw Error("An owned private directory without symlinks is required");
  return directory;
}
function privateFile(path: string): void {
  const info = lstatSync(path);
  if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())) throw Error("An exclusive owned private regular file is required");
}
function sync(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function publish(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  sync(path);
}
function readonly(path: string): Database {
  const database = new Database(path, { readonly: true, strict: true, safeIntegers: true });
  database.exec("PRAGMA query_only=ON");
  return database;
}

/** Explicit offline input only. The source is read-only; all output lives in a
 * newly created private directory. No runtime profile discovery or promotion.
 * Populated/unknown historical objects yield a blocked plan and remain intact.
 */
export function prepareHistoricalAccountCopy(sourcePath: string, outputDirectory: string) {
  const source = resolve(sourcePath), output = resolve(outputDirectory);
  const info = lstatSync(source);
  if (!info.isFile() || realpathSync(source) !== source) throw Error("An explicit regular offline source without symlinks is required");
  mkdirSync(output, { mode: 0o700 }); // Exclusive directory, never adopt existing artefacts.
  privateDirectory(output);
  const archivePath = join(output, "archive.db"), candidatePath = join(output, "candidate.db");
  // SQLITE_OPEN_READONLY protects the source. query_only would also forbid
  // VACUUM INTO's write to the separate destination, so it is archive-only.
  const database = new Database(source, { readonly: true, strict: true, safeIntegers: true });
  try {
    const before = snapshotHistoricalDatabase(database);
    createVerifiedSqliteBackup(database, source, archivePath);
    privateFile(archivePath);
    const archive = readonly(archivePath);
    try {
      if (snapshotHistoricalDatabase(archive) !== before || snapshotHistoricalDatabase(database) !== before)
        throw Error("Backup/source logical state changed; no candidate approved");
      copyFileSync(archivePath, candidatePath, constants.COPYFILE_EXCL);
      privateFile(candidatePath);
      sync(candidatePath);
      const plan = { version: 1, source, archiveSha256: digest(archivePath), ...inspectHistoricalAccounts(archive) };
      publish(join(output, "plan.json"), plan);
      sync(output);
      return plan;
    } finally { archive.close(); }
  } finally { database.close(); }
}

/** Changes only directory/candidate.db after exact plan approval. archive.db is
 * opened read-only. The original source is never opened by this operation.
 * The owned SQLite ledger is the commit receipt. A failed/missing JSON report
 * never permits a retry or promotion: inspect the ledger and preserve artefacts.
 */
export function applyHistoricalAccountCopy(outputDirectory: string, approvedSha: string) {
  const directory = privateDirectory(outputDirectory);
  const archivePath = join(directory, "archive.db"), candidatePath = join(directory, "candidate.db");
  if (existsSync(join(directory, "result.json"))) throw Error("Existing result; retries refused, inspect the owned ledger");
  for (const stem of [archivePath, candidatePath]) for (const suffix of ["-wal", "-shm", "-journal"])
    if (existsSync(stem + suffix)) throw Error("Unexpected copy sidecar; preserve artefacts and reconcile offline");
  for (const name of ["archive.db", "candidate.db", "plan.json"]) privateFile(join(directory, name));
  const recorded = JSON.parse(readFileSync(join(directory, "plan.json"), "utf8")) as {
    version: number; archiveSha256: string; sha256: string;
  };
  if (recorded.version !== 1 || recorded.sha256 !== approvedSha || !/^[a-f0-9]{64}$/.test(recorded.archiveSha256) ||
      digest(archivePath) !== recorded.archiveSha256 || digest(candidatePath) !== recorded.archiveSha256)
    throw Error("Modified artefacts or approval mismatch; preserve copies and inspect the ledger before retrying");
  const archive = readonly(archivePath);
  try {
    const candidate = new Database(candidatePath, { readwrite: true, create: false, strict: true, safeIntegers: true });
    try {
      candidate.exec("PRAGMA foreign_keys=ON");
      const plan = applyHistoricalAccounts(candidate, archive, approvedSha);
      if (digest(archivePath) !== recorded.archiveSha256) throw Error("Archive binding changed; preserve candidate and inspect ledger");
      const result = { version: 1, approvedSha, archiveSha256: recorded.archiveSha256,
        migration: { ...historicalAccountMigration, sql: undefined,
          checksum: createHash("sha256").update(historicalAccountMigration.sql).digest("hex") },
        expectedPhysicalTables: plan.expectedPhysicalTables, candidateDigest: snapshotHistoricalDatabase(candidate) };
      publish(join(directory, "result.json"), result);
      return result;
    } finally { candidate.close(); }
  } finally { archive.close(); sync(candidatePath); sync(directory); }
}
