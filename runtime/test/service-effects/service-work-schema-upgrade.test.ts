import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installServiceWorkSchema } from "../../src/service-effects/current-piclaw/service-work-schema.js";
import { applyOwnedMigrations } from "../../src/db/migrations.js";

const P = "service_effect_s01_";
// Frozen installer SQL from base 788f7fbd6, not derived from the new schema.
const HISTORICAL_SQL = `
    CREATE TABLE IF NOT EXISTS service_effect_s01_chats (
      chat_jid TEXT PRIMARY KEY,
      next_source_seq INTEGER NOT NULL DEFAULT 1 CHECK(next_source_seq >= 1),
      consumed_through_source_seq INTEGER NOT NULL DEFAULT 0 CHECK(consumed_through_source_seq >= 0),
      active_operation_id TEXT,
      UNIQUE(chat_jid, active_operation_id),
      FOREIGN KEY(chat_jid, active_operation_id)
        REFERENCES service_effect_s01_operations(chat_jid, operation_id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;

    CREATE TABLE IF NOT EXISTS service_effect_s01_sources (
      chat_jid TEXT NOT NULL,
      source_seq INTEGER NOT NULL CHECK(source_seq >= 1),
      source_id TEXT NOT NULL,
      source_hash TEXT NOT NULL CHECK(length(source_hash) = 64 AND source_hash = lower(source_hash)),
      kind TEXT NOT NULL CHECK(kind IN ('message','steer','follow_up','continuation','control','cancellation','scheduled_agent','internal')),
      state TEXT NOT NULL CHECK(state IN ('pending','claimed','queued','consumed','disposed')),
      payload_ref TEXT NOT NULL,
      target_operation_id TEXT,
      parent_source_seq INTEGER,
      accepted_at TEXT NOT NULL,
      disposition_reason TEXT,
      provenance_ref TEXT NOT NULL,
      create_wake_intent INTEGER NOT NULL CHECK(create_wake_intent IN (0,1)),
      PRIMARY KEY(chat_jid, source_seq),
      UNIQUE(chat_jid, source_id),
      FOREIGN KEY(chat_jid) REFERENCES service_effect_s01_chats(chat_jid),
      FOREIGN KEY(chat_jid, parent_source_seq)
        REFERENCES service_effect_s01_sources(chat_jid, source_seq),
      FOREIGN KEY(chat_jid, target_operation_id)
        REFERENCES service_effect_s01_operations(chat_jid, operation_id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;

    CREATE TABLE IF NOT EXISTS service_effect_s01_operations (
      operation_id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version >= 1),
      phase TEXT NOT NULL CHECK(phase IN ('accepted','claimed','starting_harness','executing','suspended','cancelling','settling','terminal')),
      primary_source_seq INTEGER NOT NULL,
      cancellation_source_id TEXT,
      cancellation_source_seq INTEGER,
      cancellation_cause TEXT,
      cancellation_requested_at TEXT,
      harness_session_id TEXT,
      harness_lane TEXT,
      harness_operation_id TEXT,
      harness_state TEXT CHECK(harness_state IS NULL OR harness_state IN ('not_started','running','suspended','aborting','finished')),
      harness_watch_generation INTEGER CHECK(harness_watch_generation IS NULL OR harness_watch_generation >= 0),
      terminal_disposition TEXT CHECK(terminal_disposition IS NULL OR terminal_disposition IN ('completed','cancelled','failed','skipped','superseded')),
      terminal_message_row_id INTEGER,
      terminal_error_code TEXT,
      terminal_committed_at TEXT,
      UNIQUE(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, primary_source_seq)
        REFERENCES service_effect_s01_sources(chat_jid, source_seq)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS service_effect_s01_one_active_operation
      ON service_effect_s01_operations(chat_jid) WHERE phase <> 'terminal';

    CREATE TABLE IF NOT EXISTS service_effect_s01_operation_sources (
      chat_jid TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      PRIMARY KEY(operation_id, source_seq),
      UNIQUE(chat_jid, source_seq),
      FOREIGN KEY(chat_jid, operation_id)
        REFERENCES service_effect_s01_operations(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, source_seq)
        REFERENCES service_effect_s01_sources(chat_jid, source_seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS service_effect_s01_intents (
      operation_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL CHECK(length(intent_hash) = 64 AND intent_hash = lower(intent_hash)),
      kind TEXT NOT NULL CHECK(kind IN ('open_harness','prompt','queue_input','abort','resume','settle','maintenance')),
      payload_ref TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(operation_id, intent_id),
      FOREIGN KEY(operation_id) REFERENCES service_effect_s01_operations(operation_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS service_effect_s01_queued_inputs (
      chat_jid TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      queue_kind TEXT NOT NULL CHECK(queue_kind IN ('steer','follow_up','next_run')),
      harness_entry_id TEXT,
      state TEXT NOT NULL CHECK(state IN ('accepted','queued','consumed','disposed')),
      PRIMARY KEY(operation_id, source_seq),
      FOREIGN KEY(chat_jid, operation_id)
        REFERENCES service_effect_s01_operations(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, source_seq)
        REFERENCES service_effect_s01_operation_sources(chat_jid, source_seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS service_effect_s01_wake_intents (
      chat_jid TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      PRIMARY KEY(chat_jid, source_seq),
      FOREIGN KEY(chat_jid, source_seq)
        REFERENCES service_effect_s01_sources(chat_jid, source_seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS service_effect_s01_decisions (
      idempotency_key TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash = lower(request_hash)),
      result_json TEXT NOT NULL CHECK(json_valid(result_json))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS service_effect_s01_pending_sources
      ON service_effect_s01_sources(chat_jid, state, source_seq);
    CREATE INDEX IF NOT EXISTS service_effect_s01_open_operations
      ON service_effect_s01_operations(chat_jid, phase, operation_id);
`;

function historical(path = ":memory:", ddl = HISTORICAL_SQL): Database {
  const db = new Database(path, { strict: true });
  db.exec("PRAGMA foreign_keys=ON");
  // Match the historical installer's single atomic writer, avoiding a separate
  // durable file commit for every fixture DDL/data statement.
  db.transaction(() => {
  db.exec(ddl);
  applyOwnedMigrations(db, [{ owner: "fixture-older-owner", id: "retained", order: 1, sql: "SELECT 1;" }]);
  db.exec(`INSERT INTO ${P}chats(chat_jid,next_source_seq,consumed_through_source_seq) VALUES ('chat',6,5)`);
  for (const seq of [1, 2, 3, 4, 5]) {
    db.query(`INSERT INTO ${P}sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,accepted_at,provenance_ref,create_wake_intent)
      VALUES ('chat',?,?,?,'message','consumed',?,?,?,0)`)
      .run(seq, `source:${seq}`, "a".repeat(64), `opaque:雪\u0000${seq}`, "2026-10-22T00:00:00.000Z", "opaque:provenance");
  }
  db.exec(`INSERT INTO ${P}operations(operation_id,chat_jid,version,phase,primary_source_seq)
    VALUES ('a','chat',7,'terminal',1),('b','chat',9,'terminal',2);
    INSERT INTO ${P}operation_sources(rowid,chat_jid,operation_id,source_seq)
    VALUES (41,'chat','a',1),(55,'chat','b',2),(70,'chat','a',3),(80,'chat','b',4),(90,'chat','a',5);
    INSERT INTO ${P}queued_inputs(rowid,chat_jid,operation_id,source_seq,queue_kind,harness_entry_id,state)
    VALUES (42,'chat','b',4,'follow_up','entry:雪','consumed'),(77,'chat','a',3,'steer',NULL,'disposed');`);
  db.query(`INSERT INTO ${P}decisions VALUES ('opaque-receipt','acceptSource',?,?)`)
    .run("b".repeat(64), '{ "kind":"source", "chatJid":"chat", "sourceSeq":1, "state":"consumed" }');
  }).immediate();
  return db;
}

function schema(db: Database) {
  return db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all();
}
function rows(db: Database) {
  return ["chats", "sources", "operations", "operation_sources", "intents", "queued_inputs", "wake_intents", "decisions"]
    .map(table => db.query(`SELECT rowid,* FROM ${P}${table} ORDER BY rowid`).all());
}
function snapshot(db: Database) {
  return [schema(db), rows(db), db.query("SELECT * FROM piclaw_schema_migrations ORDER BY owner,id").all()];
}
function parentIdentity(db: Database) {
  return db.query("SELECT sql,rootpage FROM sqlite_schema WHERE name=?").get(`${P}operation_sources`);
}
function expectForeignKeyFailure(run: () => unknown) {
  try { run(); throw Error("expected FK rejection"); }
  catch (error) { expect((error as { code?: string }).code).toBe("SQLITE_CONSTRAINT_FOREIGNKEY"); }
}

function assertFinalConstraints(db: Database) {
  // Both operations are terminal in the SAME chat: the old independent FKs
  // accepted B's queue row pointing at A's membership.
  expectForeignKeyFailure(() => db.exec(`INSERT INTO ${P}queued_inputs VALUES ('chat','b',5,'follow_up',NULL,'accepted')`));
  expectForeignKeyFailure(() => db.exec(`UPDATE ${P}queued_inputs SET operation_id='b' WHERE operation_id='a' AND source_seq=3`));
  expectForeignKeyFailure(() => db.exec(`UPDATE ${P}operation_sources SET operation_id='b' WHERE operation_id='a' AND source_seq=3`));
  expect(() => db.exec(`INSERT INTO ${P}queued_inputs VALUES ('chat','a',5,'invalid',NULL,'accepted')`)).toThrow();
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  const parentIndex = db.query(`SELECT "unique",partial FROM pragma_index_list('${P}operation_sources') WHERE name='${P}operation_source_membership'`).get();
  expect(parentIndex).toEqual({ unique: 1, partial: 0 });
  expect(db.query(`SELECT name FROM pragma_index_info('${P}operation_source_membership') ORDER BY seqno`).all())
    .toEqual([{ name: "chat_jid" }, { name: "operation_id" }, { name: "source_seq" }]);
  expect(db.query(`SELECT "unique",partial FROM pragma_index_list('${P}queued_inputs') WHERE name='${P}queued_source'`).get())
    .toEqual({ unique: 0, partial: 0 });
}

describe("EF-S01 exact queue membership owned upgrade", () => {
  test("applied queue setup preserves a reopened main-only connection without allocating temp", () => {
    const seed = new Database(":memory:");
    installServiceWorkSchema(seed);
    const db = Database.deserialize(seed.serialize()); seed.close();
    try {
      const before = db.query("PRAGMA database_list").all();
      expect(before).toEqual([{seq:0,name:"main",file:""}]);
      installServiceWorkSchema(db); installServiceWorkSchema(db);
      expect(db.query("PRAGMA database_list").all()).toEqual(before);
    } finally { db.close(); }
  });

  test("valid upgrade preserves every rowid/byte/receipt and parent identity; reopen is idempotent and fresh schema matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "work-schema-upgrade-"));
    const path = join(dir, "fixture.sqlite");
    let db = historical(path);
    try {
      const before = rows(db), parent = parentIdentity(db);
      const oldReceipts = db.query("SELECT * FROM piclaw_schema_migrations").all();
      installServiceWorkSchema(db);
      const retained = before.map((table,index)=>index!==2?table:(table as Record<string,unknown>[]).map(({harness_lane,harness_state,harness_watch_generation,...row})=>row));
      expect(rows(db)).toEqual(retained);
      expect(db.query(`SELECT * FROM ${P}legacy_harness_v1 ORDER BY operation_rowid`).all()).toEqual((before[2] as Record<string,unknown>[]).map(row=>({operation_id:row.operation_id,operation_rowid:row.rowid,harness_lane:row.harness_lane,harness_state:row.harness_state,harness_watch_generation:row.harness_watch_generation})));
      expect(parentIdentity(db)).toEqual(parent);
      expect(db.query("SELECT * FROM piclaw_schema_migrations WHERE owner='fixture-older-owner'").all()).toEqual(oldReceipts);
      assertFinalConstraints(db);
      const final = snapshot(db);
      installServiceWorkSchema(db);
      expect(snapshot(db)).toEqual(final);
      db.close(); db = new Database(path, { strict: true });
      installServiceWorkSchema(db);
      expect(snapshot(db)).toEqual(final);
      const fresh = new Database(":memory:", { strict: true });
      try {
        installServiceWorkSchema(fresh);
        expect(schema(fresh)).toEqual(schema(db).filter((row:any)=>row.tbl_name!==`${P}legacy_harness_v1`));
        expect(db.query("SELECT owner,id,migration_order,checksum FROM piclaw_schema_migrations WHERE owner=? AND migration_order=1").all("service_effect_s01"))
          .toEqual(fresh.query("SELECT owner,id,migration_order,checksum FROM piclaw_schema_migrations WHERE migration_order=1").all());
        expect(db.query("SELECT id,migration_order FROM piclaw_schema_migrations WHERE owner='service_effect_s01' AND migration_order=2").get()).toEqual({id:'retire-harness-mirrors-v1',migration_order:2});
        expect(fresh.query("SELECT id,migration_order FROM piclaw_schema_migrations WHERE owner='service_effect_s01' AND migration_order=2").get()).toEqual({id:'native-harness-binding-v1',migration_order:2});
      } finally { fresh.close(); }
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("actual ownership UNION lookups SEARCH the nonunique source index, not a queue scan", () => {
    const db = historical();
    try {
      const storeSource = readFileSync(new URL("../../src/service-effects/current-piclaw/service-work-store.ts", import.meta.url), "utf8");
      const queries = [...storeSource.matchAll(/const owned = this\.database\.query\(`([^`]+)`\)/g)].map(match => match[1]!);
      expect(queries).toHaveLength(2);
      for (const sql of queries) {
        // Release one-shot EXPLAIN programs before changing the schema.
        const statement = db.prepare(`EXPLAIN QUERY PLAN ${sql}`);
        try {
          const plan = statement.all("chat", 3, "chat", 3, 3, "chat", 3) as { detail: string }[];
          expect(plan.some(row => row.detail.includes(`SCAN ${P}queued_inputs`))).toBe(true);
        } finally { statement.finalize(); }
      }
      installServiceWorkSchema(db);
      for (const sql of queries) {
        const statement = db.prepare(`EXPLAIN QUERY PLAN ${sql}`);
        try {
          const plan = statement.all("chat", 3, "chat", 3, 3, "chat", 3) as { detail: string }[];
          const details = plan.map(row => row.detail).join("\n");
          expect(details).toContain(`SEARCH ${P}queued_inputs USING COVERING INDEX ${P}queued_source (chat_jid=? AND source_seq=?)`);
          expect(details).not.toContain(`SCAN ${P}queued_inputs`);
        } finally { statement.finalize(); }
      }
    } finally { db.close(); }
  });

  for (const malformed of ["cross-operation", "missing-membership", "missing-operation", "bad-kind", "bad-state"]) {
    test(`historical ${malformed} fails closed before any DDL/receipt mutation`, () => {
      const db = historical();
      try {
        db.exec("PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON");
        if (malformed === "cross-operation") db.exec(`UPDATE ${P}queued_inputs SET operation_id='b' WHERE source_seq=3`);
        if (malformed === "missing-membership") db.exec(`DELETE FROM ${P}operation_sources WHERE source_seq=3`);
        if (malformed === "missing-operation") db.exec(`UPDATE ${P}queued_inputs SET operation_id='private-missing-operation' WHERE source_seq=3`);
        if (malformed === "bad-kind") db.exec(`UPDATE ${P}queued_inputs SET queue_kind='private-invalid-kind' WHERE source_seq=3`);
        if (malformed === "bad-state") db.exec(`UPDATE ${P}queued_inputs SET state='private-invalid-state' WHERE source_seq=3`);
        db.exec("PRAGMA foreign_keys=ON; PRAGMA ignore_check_constraints=OFF");
        const before = snapshot(db);
        expect(() => installServiceWorkSchema(db)).toThrow("EF-S01 queue upgrade requires recognised schema and valid source membership.");
        expect(snapshot(db)).toEqual(before);
      } finally { db.close(); }
    });
  }

  for (const unexpected of [
    `ALTER TABLE ${P}queued_inputs ADD COLUMN extra TEXT`,
    `ALTER TABLE ${P}operation_sources ADD COLUMN extra TEXT`,
    `CREATE INDEX unexpected_queue_index ON ${P}queued_inputs(state)`,
    `CREATE TRIGGER unexpected_queue_trigger AFTER DELETE ON ${P}queued_inputs BEGIN SELECT 1; END`,
    `CREATE TEMP TRIGGER unexpected_temp_trigger AFTER DELETE ON main.${P}queued_inputs BEGIN SELECT 1; END`,
    `CREATE TABLE child(operation_id TEXT, source_seq INTEGER, FOREIGN KEY(operation_id,source_seq) REFERENCES ${P}queued_inputs(operation_id,source_seq) ON DELETE CASCADE)`,
    `CREATE TEMP TABLE child(operation_id TEXT, source_seq INTEGER, FOREIGN KEY(operation_id,source_seq) REFERENCES ${P}queued_inputs(operation_id,source_seq))`,
    `CREATE INDEX ${P}operation_source_membership ON ${P}operation_sources(source_seq)`,
    `CREATE UNIQUE INDEX ${P}queued_source ON ${P}queued_inputs(chat_jid,source_seq)`,
    `CREATE TABLE ${P}queued_inputs_upgrade(bytes TEXT)`,
  ]) {
    test(`rejects rather than drops unexpected schema: ${unexpected}`, () => {
      const db = historical();
      try {
        db.exec(unexpected);
        const before = snapshot(db), temp = db.query("SELECT * FROM sqlite_temp_schema ORDER BY name").all();
        expect(() => installServiceWorkSchema(db)).toThrow();
        expect(snapshot(db)).toEqual(before);
        expect(db.query("SELECT * FROM sqlite_temp_schema ORDER BY name").all()).toEqual(temp);
      } finally { db.close(); }
    });
  }

  test("mixed-case existing queue with extra retained bytes is rejected before rebuild", () => {
    const ddl = HISTORICAL_SQL.replace("service_effect_s01_queued_inputs (", "SERVICE_EFFECT_S01_QUEUED_INPUTS (")
      .replace("harness_entry_id TEXT,", "harness_entry_id TEXT, extra TEXT,");
    const db = historical(":memory:", ddl);
    try {
      db.exec(`UPDATE ${P}queued_inputs SET extra='preserved private bytes'`);
      const before = snapshot(db);
      expect(() => installServiceWorkSchema(db)).toThrow();
      expect(snapshot(db)).toEqual(before);
    } finally { db.close(); }
  });

  for (const action of ["CASCADE", "SET NULL"]) {
    test(`mixed-case queue FK ${action} is rejected with populated child intact`, () => {
      const db = historical();
      try {
        db.exec(`CREATE TABLE case_child(operation_id TEXT, source_seq INTEGER,
          FOREIGN KEY(operation_id,source_seq) REFERENCES SERVICE_EFFECT_S01_QUEUED_INPUTS(operation_id,source_seq) ON DELETE ${action});
          INSERT INTO case_child VALUES ('a',3);`);
        const before = snapshot(db), child = db.query("SELECT * FROM case_child").all();
        expect(() => installServiceWorkSchema(db)).toThrow();
        expect(snapshot(db)).toEqual(before);
        expect(db.query("SELECT * FROM case_child").all()).toEqual(child);
      } finally { db.close(); }
    });
  }

  test("populated scheduler-style child refs and custom parent objects survive without rebuilding the parent", () => {
    const db = historical();
    try {
      db.exec(`CREATE TABLE scheduler_child(operation_id TEXT, source_seq INTEGER,
        FOREIGN KEY(operation_id,source_seq) REFERENCES ${P}operation_sources(operation_id,source_seq));
        INSERT INTO scheduler_child VALUES ('a',3);
        CREATE INDEX retained_parent_index ON ${P}operation_sources(source_seq);
        CREATE TRIGGER retained_parent_trigger BEFORE DELETE ON ${P}operation_sources BEGIN SELECT RAISE(ABORT,'parent touched'); END;`);
      const parent = parentIdentity(db), custom = schema(db).filter((row: any) => row.name.startsWith("retained_"));
      installServiceWorkSchema(db);
      expect(parentIdentity(db)).toEqual(parent);
      expect(schema(db).filter((row: any) => row.name.startsWith("retained_"))).toEqual(custom);
      expect(db.query("SELECT * FROM scheduler_child").all()).toEqual([{ operation_id: "a", source_seq: 3 }]);
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });

  for (const nested of [false, true]) {
    for (const stopAfter of [1, 2, 3, 4, 5, 6]) {
      test(`rollback after migration statement ${stopAfter}, caught in outer transaction=${nested}`, () => {
        const db = historical();
        const originalExec = db.exec.bind(db);
        try {
          db.exec("CREATE TABLE outer_work(value TEXT)");
          if (nested) db.exec("BEGIN IMMEDIATE; INSERT INTO outer_work VALUES ('retained')");
          const before = snapshot(db);
          db.exec = ((sql: string) => {
            if (sql.includes(`CREATE UNIQUE INDEX IF NOT EXISTS ${P}operation_source_membership`)) {
              const statements = sql.split(";").filter(part => part.trim());
              originalExec(statements.slice(0, stopAfter).join(";") + ";");
              throw Error("injected setup fault");
            }
            return originalExec(sql);
          }) as typeof db.exec;
          expect(() => installServiceWorkSchema(db)).toThrow("injected setup fault");
          db.exec = originalExec;
          expect(snapshot(db)).toEqual(before);
          expect(db.inTransaction).toBe(nested);
          if (nested) {
            db.exec("COMMIT");
            expect(db.query("SELECT * FROM outer_work").all()).toEqual([{ value: "retained" }]);
          }
          installServiceWorkSchema(db);
          assertFinalConstraints(db);
        } finally { db.exec = originalExec; if (db.inTransaction) db.exec("ROLLBACK"); db.close(); }
      });
    }
  }

  test("ledger receipt failure rolls back rebuilt table, indexes and rowids even when caught by outer caller", () => {
    const db = historical();
    try {
      db.exec(`CREATE TRIGGER receipt_fault BEFORE INSERT ON piclaw_schema_migrations WHEN NEW.owner='service_effect_s01'
        BEGIN SELECT RAISE(ABORT,'receipt fault'); END; BEGIN IMMEDIATE;`);
      const before = snapshot(db);
      expect(() => installServiceWorkSchema(db)).toThrow("receipt fault");
      expect(snapshot(db)).toEqual(before);
      db.exec("COMMIT");
      expect(snapshot(db)).toEqual(before);
    } finally { db.close(); }
  });

  test("fresh failed installation is atomic inside an outer transaction whose caller catches and commits", () => {
    const db = new Database(":memory:", { strict: true });
    try {
      db.exec(`PRAGMA foreign_keys=ON; CREATE VIEW ${P}operations AS SELECT 1 AS value; BEGIN IMMEDIATE`);
      const before = schema(db);
      expect(() => installServiceWorkSchema(db)).toThrow();
      expect(schema(db)).toEqual(before);
      db.exec("COMMIT");
      expect(schema(db)).toEqual(before);
    } finally { db.close(); }
  });

  test("a receipt cannot mask schema drift, and a disabled-FK outer transaction is rejected", () => {
    const db = historical();
    try {
      installServiceWorkSchema(db);
      db.exec(`DROP INDEX ${P}queued_source`);
      const before = snapshot(db);
      expect(() => installServiceWorkSchema(db)).toThrow();
      expect(snapshot(db)).toEqual(before);
      db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
      expect(() => installServiceWorkSchema(db)).toThrow("foreign-key enforcement");
      expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 });
      expect(snapshot(db)).toEqual(before);
      db.exec("ROLLBACK");
    } finally { db.close(); }
  });
});
