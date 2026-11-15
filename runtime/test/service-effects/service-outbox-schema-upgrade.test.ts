import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installServiceOutboxSchema } from "../../src/service-effects/current-piclaw/service-outbox-schema.js";
import { applyOwnedMigrations } from "../../src/db/migrations.js";

const P = "service_effect_s05_", at = "2026-10-22T00:00:00.000Z", later = "2026-10-22T01:00:00.000Z";
const states = ["pending","started","completed","failed","unknown","cancelled"] as const;
type State = typeof states[number];
const expectedCertainty = (state: State) => state === "started" ? null : state === "completed" ? "applied" : state === "unknown" ? "unknown" : "not_applied";
function record(id: string, state: State, certainty: string | null = expectedCertainty(state)): Record<string,string|number|null> {
  const terminal = state !== "pending" && state !== "started";
  return { outbox_id:id, kind:"maintenance", state, idempotency_key:id, request_hash:"a".repeat(64),
    operation_id:"operation", source_seq:3, provenance_ref:"opaque:provenance", redaction_class:"private", payload_ref:"opaque:\u0000雪", destination_ref:null,
    available_at:at, enqueued_at:at, state_changed_at:at, repeatability:"reconciliation_required", attempt:state === "pending" ? 0 : 1,
    worker_id:state === "started" ? "worker" : null, claimed_at:state === "started" ? at : null,
    lease_token:state === "started" ? "opaque:lease" : null, lease_expires_at:state === "started" ? later : null,
    certainty, retry_at:null, receipt_ref:state === "completed" ? "opaque:receipt" : null,
    last_error_tag:state === "failed" || state === "unknown" ? "failed" : null, result_at:terminal ? at : null,
    reconciliation_ref:state === "cancelled" ? "opaque:reconciliation" : null, reconciled_at:state === "cancelled" ? at : null,
    cancellation_reason_tag:state === "cancelled" ? "cancelled" : null };
}
function insert(db: Database, row: ReturnType<typeof record>, rowid?: number) {
  const columns = Object.keys(row), values = Object.values(row);
  if (rowid !== undefined) { columns.unshift("rowid"); values.unshift(rowid); }
  return db.query(`INSERT INTO ${P}outbox(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`).run(...values);
}
function historical(path = ":memory:", ddl?: string) {
  const db = new Database(path); db.exec("PRAGMA foreign_keys=ON");
  // Batch fixture DDL only; the upgrade runs after this transaction commits.
  db.transaction(() => db.exec(ddl ?? readFileSync(new URL("../fixtures/service-outbox-schema-788f7fbd.sql", import.meta.url), "utf8")))();
  applyOwnedMigrations(db, [{owner:"fixture.original",id:"retained",order:1,sql:"SELECT 1;"}]);
  return db;
}
function seed(db: Database) {
  for (const [i,state] of states.entries()) insert(db,record(state,state),100+i*11);
  db.query(`INSERT INTO ${P}leases VALUES (?,?,?,?,?,?,?,?,?)`).run("b".repeat(64),"c".repeat(64),"claimNext","completed",1,"worker",at,later,null);
}
function histories(db: Database) {
  db.query(`INSERT INTO ${P}outcomes VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run("completed",1,"complete","c".repeat(64),"completed","applied",at,"opaque:receipt",null,null,null);
  db.query(`INSERT INTO ${P}resolutions VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run("completed",1,"c".repeat(64),"completed","applied",at,"opaque:resolution","opaque:receipt",null,null,null);
  db.query(`INSERT INTO ${P}decisions VALUES (?,?,?,?,?,?,?,?)`).run("decision","enqueue","c".repeat(64),"applied","completed",0,null,null);
}
function links(db: Database) {
  // Exact production child definitions; only their untouched parent keys are
  // reduced here. These rows grant no application execution authority.
  db.exec(`CREATE TABLE service_effect_s02_commits(operation_id TEXT PRIMARY KEY);
    CREATE TABLE service_effect_s07_occurrences(run_id TEXT PRIMARY KEY);
    CREATE TABLE service_effect_s02_commit_outbox (
      operation_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 99),
      outbox_id TEXT NOT NULL UNIQUE CHECK(length(outbox_id) BETWEEN 1 AND 512),
      PRIMARY KEY(operation_id,ordinal),
      FOREIGN KEY(operation_id) REFERENCES service_effect_s02_commits(operation_id),
      FOREIGN KEY(outbox_id) REFERENCES service_effect_s05_outbox(outbox_id)) STRICT;
    CREATE TABLE service_effect_s07_outbox_links (
      run_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 99),
      outbox_id TEXT NOT NULL UNIQUE CHECK(length(outbox_id) BETWEEN 1 AND 512),
      PRIMARY KEY(run_id,ordinal),
      FOREIGN KEY(run_id) REFERENCES service_effect_s07_occurrences(run_id),
      FOREIGN KEY(outbox_id) REFERENCES service_effect_s05_outbox(outbox_id)) STRICT;
    INSERT INTO service_effect_s02_commits VALUES('operation'); INSERT INTO service_effect_s07_occurrences VALUES('run');
    INSERT INTO service_effect_s02_commit_outbox VALUES('operation',0,'completed');
    INSERT INTO service_effect_s07_outbox_links VALUES('run',0,'unknown');`);
}
function schema(db: Database) { return db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all(); }
function data(db: Database) {
  return (db.query("SELECT name FROM sqlite_schema WHERE type='table' AND name<>'piclaw_schema_migrations' ORDER BY name").all() as {name:string}[])
    .map(({name})=>[name,db.query(`SELECT rowid,* FROM "${name}" ORDER BY rowid`).all()]);
}
function snapshot(db: Database) { return [schema(db),data(db),db.query("SELECT * FROM piclaw_schema_migrations ORDER BY owner,id").all()]; }
function flag(db: Database) { return (db.query("PRAGMA defer_foreign_keys").get() as {defer_foreign_keys:number}).defer_foreign_keys; }

test("applied outbox setup preserves a reopened main-only connection without allocating temp", () => {
  const seed = new Database(":memory:");
  installServiceOutboxSchema(seed);
  // ALTER TABLE allocates SQLite's empty internal temp schema. Reopen the
  // migrated main to ensure validation alone does not allocate that schema.
  const db = Database.deserialize(seed.serialize()); seed.close();
  try {
    const before = db.query("PRAGMA database_list").all();
    expect(before).toEqual([{seq:0,name:"main",file:""}]);
    installServiceOutboxSchema(db); installServiceOutboxSchema(db);
    expect(db.query("PRAGMA database_list").all()).toEqual(before);
  } finally { db.close(); }
});

test("fresh certainty CHECK accepts exactly one certainty for every delivery state", () => {
  const db = new Database(":memory:");
  try {
    installServiceOutboxSchema(db);
    for (const state of states) for (const [i,certainty] of [null,"applied","not_applied","unknown","invalid"].entries()) {
      const row=record(`${state}:${i}`,state,certainty);
      if (certainty === expectedCertainty(state)) {
        expect(()=>insert(db,row)).not.toThrow();
        expect(db.query(`SELECT certainty FROM ${P}outbox WHERE outbox_id=?`).get(row.outbox_id)).toEqual({certainty});
      } else expect(()=>insert(db,row)).toThrow();
    }
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { db.close(); }
});

test("valid upgrade preserves bytes/rowids/history and both populated incoming links; repeat and reopen are idempotent", () => {
  const dir=mkdtempSync(join(tmpdir(),"certainty-upgrade-")),path=join(dir,"owned.sqlite");
  let db=historical(path);
  try {
    db.transaction(() => { seed(db); histories(db); links(db); })();
    const before=data(db),oldReceipt=db.query("SELECT * FROM piclaw_schema_migrations").all();
    installServiceOutboxSchema(db);
    expect(data(db)).toEqual(before);
    expect(db.query("SELECT * FROM piclaw_schema_migrations WHERE owner='fixture.original'").all()).toEqual(oldReceipt);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(()=>insert(db,record("bad-null","pending",null))).toThrow();
    const final=snapshot(db);
    installServiceOutboxSchema(db); expect(snapshot(db)).toEqual(final);
    db.close(); db=new Database(path); installServiceOutboxSchema(db);
    expect(snapshot(db)).toEqual(final);
    const fresh=new Database(":memory:");
    try {
      installServiceOutboxSchema(fresh);
      expect(schema(db).filter((r:any)=>r.tbl_name.startsWith(P))).toEqual(schema(fresh).filter((r:any)=>r.tbl_name.startsWith(P)));
      expect(db.query("SELECT owner,id,migration_order,checksum FROM piclaw_schema_migrations WHERE owner='service_effect_s05'").all())
        .toEqual(fresh.query("SELECT owner,id,migration_order,checksum FROM piclaw_schema_migrations").all());
    } finally { fresh.close(); }
  } finally { db.close();rmSync(dir,{recursive:true,force:true}); }
});

for (const state of states.filter(state=>state !== "started")) test(`old ${state} NULL hole is reproduced then fails preflight without mutation or invented certainty`,()=>{
  const db=historical();
  try {
    insert(db,record("malformed",state,null));
    const before=snapshot(db);
    expect(()=>installServiceOutboxSchema(db)).toThrow("valid delivery certainty");
    expect(snapshot(db)).toEqual(before);
    expect(db.query(`SELECT certainty FROM ${P}outbox`).get()).toEqual({certainty:null});
  } finally {db.close();}
});

for (const nested of [false,true]) for (const prior of nested ? [0,1] : [0]) for (const stop of [0,1,2,3,4,5,10]) test(`certainty rebuild fault=${stop} nested=${nested} prior-deferral=${prior}`,()=>{
  const db=historical();const exec=db.exec.bind(db);
  try {
    seed(db);histories(db);links(db);
    db.exec("CREATE TABLE unrelated(value TEXT)");
    if(nested) db.exec("BEGIN IMMEDIATE;INSERT INTO unrelated VALUES('retained')");
    db.exec(`PRAGMA defer_foreign_keys=${prior}`);
    const before=snapshot(db);
    db.exec=((sql:string)=>{
      if(stop && sql.includes(`CREATE TABLE ${P}outbox_upgrade (`)) {
        exec(sql.split(";").filter(part=>part.trim()).slice(0,stop).join(";")+";");
        throw Error("injected rebuild fault");
      }
      return exec(sql);
    }) as typeof db.exec;
    if(stop) {
      expect(()=>installServiceOutboxSchema(db)).toThrow("injected rebuild fault");
      expect(snapshot(db)).toEqual(before);
    } else { const rows=data(db);installServiceOutboxSchema(db);expect(data(db)).toEqual(rows); }
    db.exec=exec;
    expect(db.inTransaction).toBe(nested);expect(flag(db)).toBe(prior);
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({foreign_keys:1});
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    if(nested){db.exec("COMMIT");expect(db.query("SELECT * FROM unrelated").all()).toEqual([{value:"retained"}]);}
    if(stop) installServiceOutboxSchema(db);
  } finally {db.exec=exec;if(db.inTransaction)db.exec("ROLLBACK");db.close();}
});

test("receipt failure after copy/index work rolls everything back and preserves caller deferral",()=>{
  const db=historical();
  try {
    seed(db);links(db);
    db.exec("CREATE TRIGGER receipt_fault BEFORE INSERT ON piclaw_schema_migrations WHEN NEW.owner='service_effect_s05' BEGIN SELECT RAISE(ABORT,'receipt fault');END;BEGIN IMMEDIATE;PRAGMA defer_foreign_keys=ON");
    const before=snapshot(db);
    expect(()=>installServiceOutboxSchema(db)).toThrow("receipt fault");expect(snapshot(db)).toEqual(before);
    expect(flag(db)).toBe(1);db.exec("COMMIT");expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {if(db.inTransaction)db.exec("ROLLBACK");db.close();}
});

test("pending unrelated deferred FK violations are never cleared even if caller catches setup failure",()=>{
  const db=historical();
  try {
    seed(db);db.exec("CREATE TABLE original_parent(id TEXT PRIMARY KEY);CREATE TABLE pending_child(id TEXT REFERENCES original_parent(id) DEFERRABLE INITIALLY DEFERRED);BEGIN IMMEDIATE;INSERT INTO pending_child VALUES('missing')");
    const before=snapshot(db);
    expect(()=>installServiceOutboxSchema(db)).toThrow("valid delivery certainty");expect(snapshot(db)).toEqual(before);
    expect(()=>db.exec("COMMIT")).toThrow();db.exec("ROLLBACK");
  } finally {if(db.inTransaction)db.exec("ROLLBACK");db.close();}
});

for (const schemaName of ["temp","attached"] as const) test(`pending ${schemaName} FK violations cannot be cleared by main outbox migration`,()=>{
  const db=historical();
  try {
    seed(db);
    if(schemaName === "attached") db.exec("ATTACH ':memory:' AS attached");
    db.exec(`CREATE TABLE ${schemaName}.original_parent(id TEXT PRIMARY KEY);
      CREATE TABLE ${schemaName}.pending_child(id TEXT REFERENCES original_parent(id) DEFERRABLE INITIALLY DEFERRED);
      BEGIN IMMEDIATE;INSERT INTO ${schemaName}.pending_child VALUES('missing')`);
    const before=snapshot(db);
    expect(()=>installServiceOutboxSchema(db)).toThrow("valid delivery certainty");expect(snapshot(db)).toEqual(before);
    expect(db.query(`SELECT * FROM ${schemaName}.pending_child`).all()).toEqual([{id:"missing"}]);
    expect(()=>db.exec("COMMIT")).toThrow();db.exec("ROLLBACK");
  } finally {if(db.inTransaction)db.exec("ROLLBACK");db.close();}
});

test("mixed-case existing outbox with extra retained bytes is rejected before rebuild",()=>{
  const ddl=readFileSync(new URL("../fixtures/service-outbox-schema-788f7fbd.sql", import.meta.url),"utf8")
    .replace("CREATE TABLE service_effect_s05_outbox (","CREATE TABLE SERVICE_EFFECT_S05_OUTBOX (")
    .replace("UNIQUE(kind,idempotency_key),","extra TEXT, UNIQUE(kind,idempotency_key),");
  const db=historical(":memory:",ddl);
  try {
    seed(db);db.exec(`UPDATE ${P}outbox SET extra='preserved private bytes'`);const before=snapshot(db);
    expect(()=>installServiceOutboxSchema(db)).toThrow();expect(snapshot(db)).toEqual(before);
  } finally {db.close();}
});

for(const action of ["CASCADE","SET NULL"]) test(`mixed-case outbox FK ${action} is rejected with populated child intact`,()=>{
  const db=historical();
  try {
    seed(db);db.exec(`CREATE TABLE case_child(id TEXT REFERENCES SERVICE_EFFECT_S05_OUTBOX(outbox_id) ON DELETE ${action});INSERT INTO case_child VALUES('completed')`);
    const before=snapshot(db);
    expect(()=>installServiceOutboxSchema(db)).toThrow();expect(snapshot(db)).toEqual(before);
    expect(db.query("SELECT * FROM case_child").all()).toEqual([{id:"completed"}]);
  } finally {db.close();}
});

test("mixed-case NO ACTION child survives outbox upgrade unchanged",()=>{
  const db=historical();
  try {
    seed(db);db.exec("CREATE TABLE case_child(id TEXT REFERENCES SERVICE_effect_S05_OUTBOX(outbox_id));INSERT INTO case_child VALUES('completed')");
    const before=data(db);installServiceOutboxSchema(db);expect(data(db)).toEqual(before);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {db.close();}
});

for(const mutation of [
  `ALTER TABLE ${P}outbox ADD COLUMN extra TEXT`,
  `DROP INDEX ${P}pending_claim;CREATE TABLE unrelated_root(value TEXT);CREATE INDEX ${P}pending_claim ON unrelated_root(value)`,
  `CREATE INDEX custom_outbox ON ${P}outbox(state)`,
  `CREATE TRIGGER custom_outbox AFTER DELETE ON ${P}outbox BEGIN SELECT 1;END`,
  `CREATE TEMP TRIGGER custom_outbox AFTER DELETE ON main.${P}outbox BEGIN SELECT 1;END`,
  `CREATE TABLE dangerous_child(id TEXT REFERENCES ${P}outbox(outbox_id) ON DELETE CASCADE)`,
  `CREATE TABLE ${P}outbox_upgrade(bytes TEXT)`,
]) test(`unsupported outbox upgrade objects are retained: ${mutation}`,()=>{
  const db=historical();
  try {
    seed(db);db.exec(mutation);const before=snapshot(db),temp=db.query("SELECT * FROM sqlite_temp_schema").all();
    expect(()=>installServiceOutboxSchema(db)).toThrow();expect(snapshot(db)).toEqual(before);expect(db.query("SELECT * FROM sqlite_temp_schema").all()).toEqual(temp);
  } finally {db.close();}
});
