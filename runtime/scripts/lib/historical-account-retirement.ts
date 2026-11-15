/** Offline, private-copy retirement only; never opens a database or discovers paths.
 * Parent must supply safeIntegers handles, a readonly:true archive with query_only=ON,
 * and private, exclusively owned paths. Bun cannot attest SQLITE_OPEN_READONLY;
 * query_only is an additional guard, not that attestation. No production promotion.
 * Reference scanning deliberately overblocks literals/column names; comments are lexed away.
 */
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { constants, type Database } from "bun:sqlite";
import { applyOwnedMigrations } from "../../src/db/migrations.js";
import { canonicalSchemaSql, readSchemaInventory, type SchemaObject } from "./schema-ownership.js";
import manifest from "./historical-account-schema.json";

const fold = (s: string) => s.replace(/[A-Z]/g, c => c.toLowerCase());
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v, (_key, value) =>
  typeof value === "bigint" ? { integer: value.toString() } : value)).digest("hex");
const key = (o: SchemaObject) => `${o.kind}:${fold(o.name)}`;
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const normal = (o: SchemaObject): SchemaObject => ({ kind: o.kind, name: fold(o.name), table: fold(o.table),
  fingerprint: o.fingerprint, ...(o.storageKind === undefined ? {} : { storageKind: o.storageKind }),
  ...(o.derived === undefined ? {} : { derived: o.derived }) });
const inventory = (db: Database) => readSchemaInventory(db).map(normal).sort((a, b) => order(key(a), key(b)));
const expected = new Map(manifest.objects.map(o => [key(o as SchemaObject), o]));
const cohortTables = new Set(manifest.objects.filter(o => o.kind === "table").map(o => o.name));
const parents = new Set(manifest.names);
const shadows = manifest.objects.filter(o => o.storageKind === "shadow").map(o => o.name);
const fts = "family_workspace_fts", ledger = "piclaw_schema_migrations";
type FK = { id: number | bigint; seq: number | bigint; table: string; from: string; to: string | null;
  on_update: string; on_delete: string; match: string };
const dependencies = manifest.dependencies as Record<string, FK[]>;
const manifestDigest = hash(manifest);
if (manifest.version !== 1 || manifest.source !== "cdc214fcc06349dc9d315c2d17c866764e4557d5" ||
    expected.size !== 157 || parents.size !== 37 || cohortTables.size !== 42 || shadows.length !== 5 ||
    Object.keys(dependencies).length !== 36) throw Error("Invalid historical schema manifest");

// DFS yields parent-first; reverse it for child-before-parent DROP order.
const visited = new Set<string>(), visiting = new Set<string>(), dropOrder: string[] = [];
function visit(name: string): void {
  if (visited.has(name)) return;
  if (visiting.has(name)) throw Error("Cyclic historical manifest dependencies");
  visiting.add(name);
  for (const parent of [...new Set((dependencies[name] ?? []).map(f => f.table))].sort(order)) {
    if (parents.has(parent)) visit(parent);
  }
  visiting.delete(name); visited.add(name); dropOrder.push(name);
}
[...parents].sort(order).forEach(visit);
export const historicalAccountMigration = Object.freeze({
  owner: "host.historical-accounts", id: "offline-empty-v1", order: 1,
  sql: [...manifest.objects.filter(o => o.kind === "trigger").map(o => o.name).sort(order)
    .map(n => `DROP TRIGGER IF EXISTS main.${quote(n)};`),
  ...dropOrder.reverse().map(n => `DROP TABLE IF EXISTS main.${quote(n)};`)].join("\n"),
});
const own = [historicalAccountMigration.owner, historicalAccountMigration.id];
const consistent = <T>(db: Database, read: () => T): T => db.inTransaction ? read() : db.transaction(read).deferred();
function boundaries(db: Database): string {
  const databases = db.query("PRAGMA database_list").all() as { name: string; file: string }[];
  if (databases.some(d => d.name !== "main" && d.name !== "temp")) throw Error("Attached schemas refused");
  if (db.query("SELECT 1 FROM temp.sqlite_schema LIMIT 1").get()) throw Error("TEMP schema objects refused");
  return databases.find(d => d.name === "main")?.file ?? "";
}
function health(db: Database, blocked: string[]): void {
  let good = 0;
  for (const row of db.query("PRAGMA main.integrity_check").iterate() as Iterable<Record<string, unknown>>) {
    if (Object.values(row)[0] !== "ok") blocked.push("integrity_check failed");
    good++;
  }
  if (good !== 1) blocked.push("integrity_check did not return a single result");
  for (const _ of db.query("PRAGMA main.foreign_key_check").iterate()) {
    blocked.push("foreign_key_check failed"); break;
  }
}

/** All logical tables, including SDK documents/provenance/markers and SQLite tables.
 * SQL tags preserve storage classes; integers/text/BLOBs never pass through lossy JS
 * conversion. Only one plaintext row is held at once; sorted row hashes are O(rows).
 * Virtual control columns (hidden=1) are not logical data; generated columns are.
 */
export function snapshotHistoricalDatabase(db: Database, retainedOnly = false): string {
  return consistent(db, () => {
    boundaries(db);
    const schema = inventory(db).filter(o => !retainedOnly || !expected.has(key(o)));
    const kinds = db.query("PRAGMA main.table_list").all() as { schema: string; name: string; wr: number | bigint }[];
    const tables: unknown[] = [];
    for (const table of schema.filter(o => o.kind === "table")) {
      const columns = (db.query(`PRAGMA main.table_xinfo(${quote(table.name)})`).all() as
        { name: string; hidden: number | bigint }[]).filter(c => Number(c.hidden) !== 1)
        .map(c => fold(c.name)).sort(order);
      const names = new Set(columns);
      const info = kinds.find(t => t.schema === "main" && fold(t.name) === table.name);
      if (!info) throw Error("Missing table metadata during snapshot");
      if (Number(info.wr) === 0) {
        const alias = ["_rowid_", "rowid", "oid"].find(name => !names.has(name));
        if (alias) {
          // Unknown virtual modules or failed metadata reads refuse the snapshot;
          // never silently omit a rowid after a failed probe.
          const probe = db.prepare(`SELECT t.${quote(alias)} FROM main.${quote(table.name)} AS t LIMIT 0`);
          probe.finalize(); columns.unshift(alias);
        }
      }
      if (!columns.length) throw Error("No accessible logical columns during snapshot");
      const projection = columns.flatMap((c, i) => {
        const value = `t.${quote(c)}`;
        return [`typeof(${value}) AS t${i}`, `CASE typeof(${value}) WHEN 'integer' THEN CAST(${value} AS TEXT)
          WHEN 'blob' THEN hex(${value}) WHEN 'text' THEN hex(CAST(${value} AS BLOB)) ELSE ${value} END AS v${i}`];
      });
      let where = "";
      if (retainedOnly && table.name === ledger) where = ` WHERE NOT (owner COLLATE BINARY IS ${literal(own[0]!)} AND id COLLATE BINARY IS ${literal(own[1]!)})`;
      if (retainedOnly && table.name === "sqlite_stat1") where = ` WHERE tbl IS NULL OR lower(tbl) NOT IN (${[...cohortTables].map(literal).join(",")})`;
      const statement = db.prepare(`SELECT ${projection.join(",")} FROM main.${quote(table.name)} AS t${where}`);
      const rows: string[] = [];
      try {
        for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
          const cells = columns.map((_, i) => {
            const type = row[`t${i}`]; let value = row[`v${i}`];
            if (type === "real") {
              const bytes = Buffer.allocUnsafe(8); bytes.writeDoubleBE(value as number); value = bytes.toString("hex");
            }
            return [type, value];
          });
          rows.push(hash(cells));
        }
      } finally { statement.finalize(); }
      tables.push({ name: table.name, columns, rows: rows.sort(order) });
    }
    return hash({ version: 1, schema, applicationId: db.query("PRAGMA main.application_id").get(),
      userVersion: db.query("PRAGMA main.user_version").get(), tables });
  });
}

function fkShape(rows: FK[]): unknown {
  return rows.map(f => [Number(f.id), Number(f.seq), fold(f.table), fold(f.from), f.to === null ? null : fold(f.to),
    f.on_update.toUpperCase(), f.on_delete.toUpperCase(), f.match.toUpperCase()])
    .sort((a, b) => order(JSON.stringify(a), JSON.stringify(b)));
}
// Reuse the SQL lexer: quotes inside comments/literals cannot swallow executable
// identifiers. The non-table mode keeps a flat token stream. Literal words still
// overblock conservatively, including SQLite's legacy single-quoted identifiers.
function references(sql: string): Set<string> {
  const tokens = (canonicalSchemaSql(sql, "view") as string[]).flatMap(token =>
    token.startsWith("'") ? token.match(/[a-zA-Z_][a-zA-Z_0-9$]*/g) ?? [] : [token]);
  return new Set(tokens.map(t => fold(t.startsWith('"') ? t.slice(1, -1).replaceAll('""', '"') :
    t.startsWith("`") ? t.slice(1, -1).replaceAll("``", "`") : t.startsWith("[") ? t.slice(1, -1) : t)));
}
export function inspectHistoricalAccounts(db: Database) {
  return consistent(db, () => {
    boundaries(db);
    const all = inventory(db), byKey = new Map(all.map(o => [key(o), o]));
    const presentTables = new Set(all.filter(o => o.kind === "table").map(o => o.name));
    const objects = all.filter(o => expected.has(key(o)));
    const blocked: string[] = [], tables: { name: string; rowCount: number }[] = [];
    try { health(db, blocked); } catch { blocked.push("Database health checks could not complete"); }
    if (!presentTables.has(ledger)) blocked.push("Existing migration ledger required");
    else {
      try {
        if (db.query(`SELECT 1 FROM main.${quote(ledger)} WHERE owner = ? AND id = ? LIMIT 1`).get(...own))
          blocked.push("Historical retirement receipt already exists; retries refused");
      } catch { blocked.push("Migration ledger cannot be qualified"); }
    }
    for (const declared of manifest.objects) {
      const actual = byKey.get(key(declared as SchemaObject));
      if (actual) {
        if (hash(actual) !== hash(normal(declared as SchemaObject))) blocked.push(`Schema drift: ${key(actual)}`);
        if (!presentTables.has(declared.table)) blocked.push(`Missing parent: ${key(actual)}`);
        for (const ref of declared.references) if (!presentTables.has(ref)) blocked.push(`Missing dependency: ${ref}`);
      } else if (declared.kind !== "table" && presentTables.has(declared.table) &&
          (cohortTables.has(declared.table) || declared.references.some(ref => presentTables.has(ref)))) {
        blocked.push(`Missing declared child: ${key(declared as SchemaObject)}`);
      }
    }
    const workspaceGroup = [fts, ...shadows, "family_workspace_files", "family_workspace_index_status", "family_workspace_index_generation"];
    if (workspaceGroup.some(n => presentTables.has(n))) {
      for (const name of workspaceGroup) if (!presentTables.has(name)) blocked.push(`Partial FTS: ${name}`);
      for (const name of shadows.filter(n => presentTables.has(n))) {
        try {
          const info = db.query("SELECT wr FROM pragma_table_list WHERE schema='main' AND name=?").get(name) as { wr: number | bigint };
          const columns = [...(Number(info.wr) === 0 ? ["_rowid_"] : []),
            ...(db.query(`PRAGMA main.table_info(${quote(name)})`).all() as { name: string }[]).map(c => c.name)];
          const projection = columns.map(c => `typeof(t.${quote(c)}) || ':' || hex(CAST(t.${quote(c)} AS BLOB))`).join(",");
          const rows = db.query(`SELECT ${projection} FROM main.${quote(name)} AS t`).values().map(row => JSON.stringify(row)).sort(order);
          if (hash(rows) !== hash((manifest.emptyFtsRows as Record<string, string[]>)[name])) blocked.push(`Nonempty or changed FTS shadow: ${name}`);
        } catch { blocked.push(`Cannot qualify FTS shadow: ${name}`); }
      }
    }
    for (const o of all) {
      const known = expected.has(key(o));
      if (!known && (cohortTables.has(o.table) || cohortTables.has(o.name))) blocked.push(`Unknown cohort object: ${key(o)}`);
      if (o.kind === "table") {
        try {
          const fks = db.query(`PRAGMA main.foreign_key_list(${quote(o.name)})`).all() as FK[];
          if (known && dependencies[o.name]) {
            if (hash(fkShape(fks)) !== hash(fkShape(dependencies[o.name]!))) blocked.push(`Foreign key drift: ${o.name}`);
            for (const fk of fks) if (!presentTables.has(fold(fk.table))) blocked.push(`Missing FK parent: ${o.name}`);
          } else if (!known && fks.some(f => cohortTables.has(fold(f.table)))) blocked.push(`Incoming foreign key: ${o.name}`);
        } catch { blocked.push(`Cannot qualify foreign keys: ${o.name}`); }
      }
      if (!known && (o.kind === "trigger" || o.kind === "view")) {
        const row = db.query("SELECT sql FROM main.sqlite_schema WHERE type = ? AND name = ? COLLATE NOCASE")
          .get(o.kind, o.name) as { sql: string } | null;
        if (!row || [...references(row.sql)].some(n => cohortTables.has(n))) blocked.push(`Retained reference: ${key(o)}`);
      }
    }
    for (const name of [...cohortTables].sort(order)) {
      if (!presentTables.has(name)) continue;
      try {
        const rowCount = Number((db.query(`SELECT count(*) AS n FROM main.${quote(name)}`).get() as { n: number | bigint }).n);
        if (!Number.isSafeInteger(rowCount)) throw Error("Unsafe count");
        tables.push({ name, rowCount });
        if (shadows.includes(name)) continue; // Permitted only with exact, empty virtual parent (checked above/below).
        if (rowCount === 0) continue;
        if (name === "family_workspace_index_generation" && rowCount === 1 && db.query(`SELECT 1 FROM main.${quote(name)}
          WHERE typeof(id)='integer' AND id=1 AND typeof(revision)='integer' AND revision=0`).get()) continue;
        blocked.push(`Nonempty historical table: ${name}`);
      } catch { blocked.push(`Cannot count historical table: ${name}`); }
    }
    let sourceDigest: string;
    try { sourceDigest = snapshotHistoricalDatabase(db); } catch { throw Error("Historical logical snapshot could not complete"); }
    const expectedPhysicalTables = tables.length;
    const reasons = [...new Set(blocked)].sort(order);
    const sha256 = hash({ manifestDigest, sourceDigest, migration: historicalAccountMigration,
      expectedRemovedObjects: objects, dataCounts: tables, expectedPhysicalTables, blocked: reasons });
    return { sha256, sourceDigest, objects, tables, blocked: reasons, expectedPhysicalTables };
  });
}

function distinctFiles(candidate: Database, archive: Database): void {
  const a = boundaries(candidate), b = boundaries(archive);
  if (!a || !b || candidate === archive) throw Error("Two distinct file-backed handles required");
  for (const db of [candidate, archive]) {
    const moved = new Int32Array(2);
    if (db.fileControl("main", constants.SQLITE_FCNTL_HAS_MOVED, moved) !== 0 || moved[0] !== 0)
      throw Error("Historical file binding changed");
  }
  const sa = statSync(a, { bigint: true }), sb = statSync(b, { bigint: true });
  if (!sa.isFile() || !sb.isFile() || realpathSync(a) === realpathSync(b) || (sa.dev === sb.dev && sa.ino === sb.ino))
    throw Error("Candidate and archive must be different physical files");
  const policy = archive.query("PRAGMA query_only").get() as { query_only: number | bigint };
  if (Number(policy.query_only) !== 1) throw Error("Archive requires query_only=ON and parent-attested readonly handle");
}
export function applyHistoricalAccounts(candidate: Database, archive: Database, approvedSha: string) {
  if (candidate.inTransaction || archive.inTransaction) throw Error("Caller transactions refused");
  if (!/^[a-f0-9]{64}$/.test(approvedSha)) throw Error("Invalid historical approval digest");
  distinctFiles(candidate, archive);
  if (Number((candidate.query("PRAGMA foreign_keys").get() as { foreign_keys: number | bigint }).foreign_keys) !== 1)
    throw Error("Candidate foreign-key enforcement is required");
  archive.exec("BEGIN");
  try {
    const archived = inspectHistoricalAccounts(archive); // Establish the archive's consistent read before candidate writes.
    return candidate.transaction(() => {
      distinctFiles(candidate, archive);
      const plan = inspectHistoricalAccounts(candidate); // Reinspect under the outer IMMEDIATE lock, before any DDL/ledger write.
      if (plan.blocked.length || archived.blocked.length) throw Error("Historical retirement blocked; inspect metadata-only plan");
      if (plan.sha256 !== approvedSha || archived.sha256 !== approvedSha || plan.sourceDigest !== archived.sourceDigest)
        throw Error("Approval/archive/candidate logical state mismatch");
      const before = inventory(candidate), retained = snapshotHistoricalDatabase(candidate, true);
      const afterExpected = before.filter(o => !expected.has(key(o)));
      applyOwnedMigrations(candidate, [historicalAccountMigration]); // Sole ledger owner; nested savepoint, never a separate commit.
      const after = inventory(candidate);
      if (hash(after) !== hash(afterExpected) || before.filter(o => o.kind === "table").length -
          after.filter(o => o.kind === "table").length !== plan.expectedPhysicalTables) throw Error("Unexpected post-retirement schema");
      if (snapshotHistoricalDatabase(candidate, true) !== retained) throw Error("Retained logical state changed");
      const receipt = candidate.query(`SELECT migration_order,checksum FROM main.${quote(ledger)} WHERE owner = ? AND id = ?`).all(...own) as
        { migration_order: number | bigint; checksum: string }[];
      if (receipt.length !== 1 || Number(receipt[0]!.migration_order) !== historicalAccountMigration.order ||
          receipt[0]!.checksum !== createHash("sha256").update(historicalAccountMigration.sql).digest("hex")) throw Error("Invalid retirement receipt");
      const blocked: string[] = []; health(candidate, blocked);
      if (blocked.length) throw Error("Post-retirement health checks failed");
      distinctFiles(candidate, archive);
      // Release archive BEFORE candidate commit: even an archive-finalization failure rolls candidate back.
      archive.exec("ROLLBACK");
      return plan;
    }).immediate();
  } finally { if (archive.inTransaction) archive.exec("ROLLBACK"); }
}
