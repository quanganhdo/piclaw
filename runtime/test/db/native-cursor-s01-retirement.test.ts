import {expect,test} from "bun:test";
import {Database} from "bun:sqlite";
import {readFileSync} from "node:fs";
import {initializeChatCursorStorage,legacyCursorArchive} from "../../src/db/chat-cursor-storage.js";
import {ensureOwnedMigrationLedger} from "../../src/db/migrations.js";
import {readSchemaInventory} from "../../scripts/lib/schema-ownership.js";
import "../helpers.js";
const ddl=readFileSync(new URL("../fixtures/chat-cursors-s01-owner-v1.sql",import.meta.url),"utf8");
const guards=["chat_cursors_legacy_owner_exclusion","chat_cursors_active_owner_delete_exclusion"];
const quote=(s:string)=>`"${s.replaceAll('"','""')}"`;
function fixture(run:(db:Database)=>void,sql=ddl){const db=new Database(":memory:");db.exec("PRAGMA foreign_keys=ON");try{db.exec(sql);const cols=db.query("PRAGMA table_info(chat_cursors)").all() as {name:string;type:string}[];for(const id of [71,93]){const values=cols.map(c=>c.name==="chat_jid"?`historic-${id}`:c.type==="INTEGER"?id+100:c.name==="queued_followups_json"?"{malformed queue":`historical ${c.name} ${id}`);db.query(`INSERT INTO chat_cursors(rowid,${cols.map(c=>quote(c.name)).join(",")}) VALUES(${Array(cols.length+1).fill("?").join(",")})`).run(id,...values)}run(db)}finally{db.close()}}
function snapshot(db:Database){return{temp:db.query("SELECT * FROM sqlite_temp_schema ORDER BY type,name").all(),archive:db.query("SELECT 1 FROM sqlite_schema WHERE name=?").get(legacyCursorArchive)?db.query(`SELECT rowid,* FROM ${legacyCursorArchive} ORDER BY rowid`).all():[],schema:db.query("SELECT * FROM sqlite_schema ORDER BY type,name").all(),rows:db.query("SELECT rowid,* FROM chat_cursors ORDER BY rowid").all(),receipts:db.query("SELECT 1 FROM sqlite_schema WHERE name='piclaw_schema_migrations'").get()?db.query("SELECT * FROM piclaw_schema_migrations ORDER BY owner,id").all():[]}}
function refuse(db:Database){const before=snapshot(db);expect(()=>initializeChatCursorStorage(db)).toThrow("Unsupported chat cursor retirement schema or receipt");expect(snapshot(db)).toEqual(before)}

test("recognised S01 owner generation preserves every field/rowid, malformed queue and other receipts; reopens without old guards",()=>fixture(db=>{
 ensureOwnedMigrationLedger(db);db.exec("INSERT INTO piclaw_schema_migrations VALUES('other-owner','keep',4,'original-checksum','original-time')");
 const original=db.query("SELECT rowid,* FROM chat_cursors ORDER BY rowid").all();initializeChatCursorStorage(db);
 expect(db.query(`SELECT rowid,* FROM ${legacyCursorArchive} ORDER BY rowid`).all()).toEqual(original);
 expect(db.query("PRAGMA table_info(chat_cursors)").all().map((x:any)=>x.name)).toEqual(["chat_jid","cursor_ts","queued_followups_json"]);
 expect(db.query("SELECT name FROM sqlite_schema WHERE type='trigger'").all()).toEqual([]);
 expect(db.query("SELECT id FROM piclaw_schema_migrations WHERE owner='host.chat-cursors'").get()).toEqual({id:"native-frontier-s01-owner-v1"});
 expect(db.query("SELECT checksum,applied_at FROM piclaw_schema_migrations WHERE owner='other-owner'").get()).toEqual({checksum:"original-checksum",applied_at:"original-time"});
 const receipt=db.query("SELECT * FROM piclaw_schema_migrations").all();db.exec("UPDATE chat_cursors SET cursor_ts='current native position' WHERE chat_jid='historic-71'");initializeChatCursorStorage(db);
 expect(db.query("SELECT * FROM piclaw_schema_migrations").all()).toEqual(receipt);expect(db.query(`SELECT rowid,* FROM ${legacyCursorArchive} ORDER BY rowid`).all()).toEqual(original);
 expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
}));
for(const name of guards){
 test(`missing recognised guard refuses atomically: ${name}`,()=>fixture(db=>{db.exec(`DROP TRIGGER ${name}`);refuse(db)}));
 test(`altered recognised guard refuses atomically: ${name}`,()=>fixture(db=>refuse(db),ddl.replace(name===guards[0]?"active operation excludes legacy ownership mutation":"active operation excludes cursor deletion","changed guard condition")));
}
test("missing both guards never adopts an unguarded operation generation",()=>fixture(db=>{for(const name of guards)db.exec(`DROP TRIGGER ${name}`);refuse(db)}));
for(const column of ["operation_generation","operation_source_seq","auto_compaction_updated_at"]){test(`partial physical generation refuses: ${column}`,()=>fixture(db=>{db.exec(`ALTER TABLE chat_cursors DROP COLUMN ${column}`);refuse(db)}))}
test("unknown extra column refuses without touching recognised guards",()=>fixture(db=>{db.exec("ALTER TABLE chat_cursors ADD COLUMN unknown_owner TEXT");refuse(db)}));
test("changed operation declaration refuses",()=>fixture(db=>refuse(db),ddl.replace("operation_generation INTEGER","operation_generation INTEGER DEFAULT 0")));
for(const dependent of ["CREATE VIEW unknown_cursor_view AS SELECT * FROM chat_cursors","CREATE TABLE unknown_child(chat TEXT REFERENCES chat_cursors(chat_jid))","CREATE TRIGGER unknown_cursor_guard BEFORE DELETE ON chat_cursors BEGIN SELECT RAISE(ABORT,'unknown'); END"]){test("unknown dependency still refuses: "+dependent.split(" ").slice(0,3).join(" "),()=>fixture(db=>{db.exec(dependent);refuse(db)}))}
test("temporary trigger with recognised name never gains approval",()=>fixture(db=>{db.exec("DROP TRIGGER chat_cursors_active_owner_delete_exclusion");const start=ddl.indexOf("CREATE TRIGGER chat_cursors_active_owner_delete_exclusion");db.exec(ddl.slice(start).replace("CREATE TRIGGER","CREATE TEMP TRIGGER"));refuse(db)}));
test("receipt failure restores all guards, old schema, rowids and operation fields",()=>fixture(db=>{
 ensureOwnedMigrationLedger(db);db.exec("CREATE TRIGGER refuse_cursor_receipt BEFORE INSERT ON piclaw_schema_migrations WHEN new.owner='host.chat-cursors' BEGIN SELECT RAISE(ABORT,'receipt refused'); END");
 const before=snapshot(db);expect(()=>initializeChatCursorStorage(db)).toThrow("receipt refused");expect(snapshot(db)).toEqual(before);
}));
test("caller rollback restores owned guards and all history",()=>fixture(db=>{const before=snapshot(db);expect(()=>db.transaction(()=>{initializeChatCursorStorage(db);throw Error("caller rollback")}).immediate()).toThrow("caller rollback");expect(snapshot(db)).toEqual(before)}));
test("wrong historical receipt cannot adopt an operation archive",()=>fixture(db=>{initializeChatCursorStorage(db);db.exec("UPDATE piclaw_schema_migrations SET id='native-frontier-v1' WHERE owner='host.chat-cursors'");refuse(db)}));
test("archive drift fails closed",()=>fixture(db=>{initializeChatCursorStorage(db);db.exec(`ALTER TABLE ${legacyCursorArchive} DROP COLUMN operation_generation`);refuse(db)}));
test("recognised original and archived generation have exact registered schema fingerprints",()=>fixture(db=>{
 const manifest=JSON.parse(readFileSync(new URL("../../scripts/schema-ownership.json",import.meta.url),"utf8"));
 const original=readSchemaInventory(db).find(x=>x.kind==="table"&&x.name==="chat_cursors")!;expect(manifest.objects["table:chat_cursors"].fingerprints).toContain(original.fingerprint);
 initializeChatCursorStorage(db);const archived=readSchemaInventory(db).find(x=>x.kind==="table"&&x.name===legacyCursorArchive)!;expect(manifest.objects[`table:${legacyCursorArchive}`].fingerprints).toContain(archived.fingerprint);
}));
