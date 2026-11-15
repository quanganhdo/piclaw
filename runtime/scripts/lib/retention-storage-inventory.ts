import { Database } from "bun:sqlite";
import { lstatSync, readFileSync } from "node:fs";
import { assertOfflineRecoveryPath, fingerprintRecoveryFile } from "./native-recovery-unit.js";
import { assertSchemaInventory, readSchemaInventory, type SchemaContract } from "./schema-ownership.js";

function storageClass(table:string):string {
  if(["conversations","entries","documents","document_revisions","record_ids"].includes(table))return "sdk-history-and-provenance";
  if(["tasks","submissions"].includes(table))return "sdk-execution-identities";
  if(table.startsWith("budget_"))return "accounting-and-holds";
  if(table.startsWith("service_effect_s07_"))return "scheduler-replay";
  if(table.startsWith("piclaw_durable_")||/^service_effect_s0[125]_/.test(table))return "native-admission-effects";
  if(table.startsWith("tool_outputs"))return "tool-output-cache-and-handles";
  if(table==="token_usage")return "usage-reports";
  if(table.startsWith("addon_code_review_"))return "saved-code-review";
  if(table.includes("media"))return "media-and-links";
  return "other-owned-host-state";
}
/** Measurements ONLY on an explicit sealed disposable snapshot. No connection
 * to a live profile, write, checkpoint, VACUUM, retention decision or scheduling.
 * Logical bytes exclude SQLite overhead; allocated bytes are independent dbstat
 * observations and do not predict file-size reclamation after deletion. */
export function measureRetentionStorage(path:string) {
  const source=assertOfflineRecoveryPath(path),before=fingerprintRecoveryFile(source);
  for(const suffix of ["-wal","-shm","-journal"]){
    try{lstatSync(source+suffix);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")continue;throw error;}
    throw Error("Sealed retention measurement snapshot required");
  }
  const database=new Database(source,{readonly:true,strict:true});
  try{
    database.exec("PRAGMA query_only=ON;BEGIN");
    const objects=readSchemaInventory(database),contract=JSON.parse(readFileSync(new URL("../schema-ownership.json",import.meta.url),"utf8")) as SchemaContract;
    assertSchemaInventory(objects,contract,"native");
    const classes:Record<string,{rows:number;logicalValueBytes:number;allocatedBytes:number|null;tables:string[]}>={};
    const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
    const group=(table:string)=>classes[storageClass(table)]??=( {rows:0,logicalValueBytes:0,allocatedBytes:0,tables:[]} );
    for(const table of objects.filter(object=>object.kind==="table"&&object.storageKind!=="shadow")){
      const columns=database.query(`PRAGMA main.table_info(${quote(table.name)})`).all() as {name:string}[];
      const sum=columns.map(column=>`COALESCE(length(CAST(${quote(column.name)} AS BLOB)),0)`).join("+")||"0";
      const row=database.query(`SELECT count(*) AS n,COALESCE(sum(${sum}),0) AS bytes FROM main.${quote(table.name)}`).get() as {n:number;bytes:number};
      if(!Number.isSafeInteger(row.n)||!Number.isSafeInteger(row.bytes))throw Error("Unsafe retention measurement size");
      const entry=group(table.name);entry.rows+=row.n;entry.logicalValueBytes+=row.bytes;entry.tables.push(table.name);
    }
    let allocation:"dbstat"|"unavailable"="dbstat";
    const modules=database.query("PRAGMA module_list").all() as {name:string}[];
    if(modules.some(module=>module.name==="dbstat")){
      const allocations=database.query("SELECT name,sum(pgsize) AS bytes FROM dbstat GROUP BY name").all() as {name:string;bytes:number}[];
      for(const item of allocations){const object=objects.find(object=>object.name===item.name);group(object?.table??item.name).allocatedBytes!+=item.bytes;}
    }else{allocation="unavailable";for(const entry of Object.values(classes))entry.allocatedBytes=null;}
    const pragma=(name:string)=>Object.values(database.query(`PRAGMA main.${name}`).get() as Record<string,number>)[0]!;
    const result={version:1,databaseSha256:before.sha256,databaseBytes:before.byteLength,allocation,
      allocationNote:allocation==="unavailable"?"SQLite dbstat is unavailable; only logical value bytes are measured":null,
      pageSize:pragma("page_size"),pageCount:pragma("page_count"),freelistPages:pragma("freelist_count"),classes};
    if(JSON.stringify(fingerprintRecoveryFile(source))!==JSON.stringify(before))throw Error("Retention measurement source changed");
    return result;
  }finally{if(database.inTransaction)database.exec("ROLLBACK");database.close();}
}
