import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";

export interface OwnedSchemaMigration {
  owner: string;
  id: string;
  order: number;
  sql: string;
}

export interface AppliedOwnedSchemaMigration {
  owner: string;
  id: string;
  checksum: string;
  applied_at: string;
}

const LEDGER_TABLE = "piclaw_schema_migrations";

function checksumSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export function ensureOwnedMigrationLedger(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      owner TEXT NOT NULL,
      id TEXT NOT NULL,
      migration_order INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (owner, id)
    ) WITHOUT ROWID;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_piclaw_schema_migrations_owner_order
      ON ${LEDGER_TABLE}(owner, migration_order);
  `);
}

export function listAppliedOwnedMigrations(database: Database, owner?: string): AppliedOwnedSchemaMigration[] {
  ensureOwnedMigrationLedger(database);
  const sql = owner
    ? `SELECT owner, id, checksum, applied_at FROM ${LEDGER_TABLE} WHERE owner = ? ORDER BY migration_order, id`
    : `SELECT owner, id, checksum, applied_at FROM ${LEDGER_TABLE} ORDER BY owner, migration_order, id`;
  return (owner ? database.prepare(sql).all(owner) : database.prepare(sql).all()) as AppliedOwnedSchemaMigration[];
}

export function applyOwnedMigrations(database: Database, migrations: readonly OwnedSchemaMigration[]): void {
  // Validate the complete declaration before any DDL, then serialize the state
  // lookup and application with competing initializers (savepoint when nested).
  const sorted = migrations.map(migration => ({ ...migration, owner: migration.owner.trim(), id: migration.id.trim() }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const seenKeys = new Set<string>();
  const seenOrders = new Set<string>();
  for (const migration of sorted) {
    const owner = migration.owner.trim();
    const id = migration.id.trim();
    if (!owner || !id || !Number.isSafeInteger(migration.order) || migration.order < 1) {
      throw new Error("Schema migrations require non-empty owner/id and a positive integer order.");
    }
    const key = `${owner}\0${id}`;
    const orderKey = `${owner}\0${migration.order}`;
    if (seenKeys.has(key) || seenOrders.has(orderKey)) {
      throw new Error(`Duplicate schema migration identity/order for ${owner}:${id}.`);
    }
    seenKeys.add(key);
    seenOrders.add(orderKey);
  }
  database.transaction(() => {
    ensureOwnedMigrationLedger(database);
    for (const { owner, id, order, sql } of sorted) {
      const checksum = checksumSql(sql);
      const applied = database.prepare(`SELECT owner, id, migration_order, checksum FROM ${LEDGER_TABLE} WHERE owner = ? AND id = ?`)
        .get(owner, id) as { owner: string; id: string; migration_order: number; checksum: string } | undefined;
      if (applied) {
        if (applied.owner !== owner || applied.id !== id) throw Error("Schema migration identity mismatch.");
        if (applied.migration_order !== order) throw Error(`Schema migration order mismatch for ${owner}:${id}.`);
        if (applied.checksum !== checksum) throw Error(`Schema migration checksum mismatch for ${owner}:${id}.`);
        continue;
      }
      database.exec(sql);
      database.prepare(`
        INSERT INTO ${LEDGER_TABLE}(owner, id, migration_order, checksum, applied_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(owner, id, order, checksum, new Date().toISOString());
    }
  }).immediate();
}
