import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { collectNativeRecoveryReferences } from "../scripts/lib/native-recovery-references.js";

const id = "side-prompt:11111111-1111-4111-8111-111111111111";
function fixture() {
  const db = new Database(":memory:");
  // A collector-only fixture. Native storage/paused restore is qualified separately.
  db.exec(`CREATE TABLE service_effect_s01_sources(chat_jid TEXT,source_seq INTEGER,kind TEXT,source_id TEXT,payload_ref TEXT);
    CREATE TABLE service_effect_s01_operations(operation_id TEXT,chat_jid TEXT,phase TEXT,terminal_disposition TEXT,terminal_message_row_id INTEGER);
    CREATE TABLE piclaw_durable_bindings_v1(incarnation TEXT,submission_id INTEGER,operation_id TEXT,chat_jid TEXT,source_seq INTEGER,conversation_id INTEGER DEFAULT 1,request_id TEXT DEFAULT 'primary');
    CREATE TABLE piclaw_durable_intent_bindings_v1(incarnation TEXT,submission_id INTEGER,operation_id TEXT,chat_jid TEXT,source_seq INTEGER,conversation_id INTEGER,request_id TEXT);
    CREATE TABLE extension_kv(extension_id TEXT,scope TEXT,scope_key TEXT,key TEXT,value TEXT);
    CREATE TABLE service_effect_s05_outbox(payload_ref TEXT,redaction_class TEXT);`);
  return db;
}
test("recovery references distinguish native files, DB-owned input and adapter payloads without writes", () => {
  const db = fixture();
  try {
    db.query("INSERT INTO service_effect_s01_sources VALUES('web:x',1,'internal',?,?)").run(id,id);
    db.exec(`INSERT INTO service_effect_s01_sources VALUES('web:y',1,'message','user-1','message-row:17');
      INSERT INTO service_effect_s01_operations VALUES('side','web:x','terminal','completed',NULL),('main','web:y','terminal','failed',18);
      INSERT INTO piclaw_durable_bindings_v1(incarnation,submission_id,operation_id,chat_jid,source_seq) VALUES('domain',8,'side','web:x',1),('domain',9,'main','web:y',1);
      INSERT INTO service_effect_s05_outbox VALUES('opaque:notification','private'),('opaque:notification','private');`);
    const before = db.serialize();
    const refs = collectNativeRecoveryReferences(db);
    expect(refs.map(row=>[row.owner,row.ref,row.location])).toEqual([
      ["native-answer","runtime-answer:domain:8","answers"], ["native-answer","runtime-answer:domain:9","answers"],
      ["native-side-input",id,"answers"], ["native-side-result",`side-result:${id}`,"answers"], ["outbox","opaque:notification","external"],
    ]);
    expect(db.serialize()).toEqual(before);
    expect(Object.isFrozen(refs)).toBe(true);
  } finally { db.close(); }
});
test("recovery references retain cancelled input but do not invent cancelled/failed-private result files", () => {
  const db = fixture();
  try {
    db.query("INSERT INTO service_effect_s01_sources VALUES('web:x',1,'internal',?,?)").run(id,id);
    db.exec("INSERT INTO service_effect_s01_operations VALUES('side','web:x','terminal','cancelled',NULL); INSERT INTO piclaw_durable_bindings_v1(incarnation,submission_id,operation_id,chat_jid,source_seq) VALUES('domain',8,'side','web:x',1)");
    expect(collectNativeRecoveryReferences(db)).toEqual([{ owner:"native-side-input",ref:id,location:"answers",mediaType:"text/plain",redactionClass:"private" }]);
    db.exec("UPDATE service_effect_s01_operations SET terminal_disposition='failed'");
    expect(collectNativeRecoveryReferences(db)).toHaveLength(1);
    db.exec("UPDATE service_effect_s01_operations SET terminal_disposition='completed'; UPDATE piclaw_durable_bindings_v1 SET submission_id=NULL");
    expect(()=>collectNativeRecoveryReferences(db)).toThrow("submission binding");
  } finally { db.close(); }
});
test("recovery references reject unclassified internal sources instead of silently claiming completeness", () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO service_effect_s01_sources VALUES('web:x',1,'internal','unknown','private-file')");
    expect(()=>collectNativeRecoveryReferences(db)).toThrow("Unsupported internal");
  } finally { db.close(); }
});
test("recovery references select the published attached SDK input by placement or first model failure",()=>{
  const db=fixture();
  try{
    db.exec(`INSERT INTO service_effect_s01_sources VALUES('web:x',1,'message','main','message-row:1');
      INSERT INTO service_effect_s01_operations VALUES('op','web:x','terminal','completed',2);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('domain',8,'op','web:x',1,1,'primary');
      INSERT INTO piclaw_durable_intent_bindings_v1 VALUES('domain',9,'op','web:x',2,1,'intent');`);
    const primary={id:8,conversationId:1,requestId:'primary',type:'input',status:'done',entry:20};
    const intent={id:9,conversationId:1,requestId:'intent',type:'input',status:'done',entry:30};
    expect(()=>collectNativeRecoveryReferences(db)).toThrow('submission proof');
    expect(collectNativeRecoveryReferences(db,new Map([[8,primary],[9,intent]]))[0]!.ref).toBe('runtime-answer:domain:9');
    expect(collectNativeRecoveryReferences(db,new Map([[8,{...primary,entry:40}],[9,intent]]))[0]!.ref).toBe('runtime-answer:domain:8');
    expect(()=>collectNativeRecoveryReferences(db,new Map([[8,primary],[9,{...intent,conversationId:2}]]))).toThrow('submission proof');
    expect(()=>collectNativeRecoveryReferences(db,new Map([[8,primary],[9,{...intent,entry:20}]]))).toThrow('Ambiguous');
    db.exec("UPDATE service_effect_s01_operations SET terminal_disposition='failed'");
    expect(collectNativeRecoveryReferences(db,new Map([[8,primary],[9,{...intent,status:'unanswered',entry:undefined,reason:'model_error'}]]))[0]!.ref).toBe('runtime-answer:domain:9');
  }finally{db.close();}
});
test("recovery references bind nested Codex files to saved owner/hash/length and refuse traversal or corruption", () => {
  const db = fixture();
  const image = { path: ".pi/openai-codex-images/nested/a.png", sha256:"a".repeat(64),bytes:10,callId:"call",codexOperationId:"codex",mimeType:"image/png" };
  const insert = (value: unknown) => { db.exec("DELETE FROM extension_kv"); db.query("INSERT INTO extension_kv VALUES('codex-conversion','chat','web:x','outputrefs:host',?)").run(JSON.stringify(value)); };
  try {
    insert({ hostOperationId:"host",chatJid:"web:x",refs:[image] });
    expect(collectNativeRecoveryReferences(db)).toEqual([{owner:"codex-image",ref:image.path,location:"workspace",mediaType:"image/png",redactionClass:"private",sha256:image.sha256,byteLength:10}]);
    for (const changed of [{...image,path:".pi/openai-codex-images/../auth.json"},{...image,sha256:"wrong"},{...image,bytes:-1},{...image,callId:""}]) {
      insert({hostOperationId:"host",chatJid:"web:x",refs:[changed]});
      expect(()=>collectNativeRecoveryReferences(db)).toThrow("Invalid Codex recovery image");
    }
    insert({hostOperationId:"other",chatJid:"web:x",refs:[image]});
    expect(()=>collectNativeRecoveryReferences(db)).toThrow("owner");
  } finally { db.close(); }
});
