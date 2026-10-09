import '../setup-filesystem-isolation.js';
import {Database} from 'bun:sqlite';
import {performance} from 'node:perf_hooks';
import {initDatabase,getDb,closeDatabase} from '../../src/db/connection.js';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
if(process.argv.includes('--existing')){
 mkdirSync(process.env.PICLAW_STORE!,{recursive:true});const seed=new Database(join(process.env.PICLAW_STORE!,'messages.db'));
 seed.exec('CREATE TABLE fixture_legacy (value TEXT); INSERT INTO fixture_legacy VALUES (\'retained\');');seed.close();
}
const metrics:Record<string,{count:number;wallMs:number}>={};
const original=Database.prototype.exec;
Database.prototype.exec=function(sql:string){
 const key=sql.includes('CREATE TABLE IF NOT EXISTS chats (')?'base-schema':/^VACUUM\s*;?$/i.test(sql.trim())?'late-vacuum':/^\s*(?:CREATE|ALTER|DROP)/i.test(sql)?'other-ddl':'pragma/other';
 const start=performance.now();try{return original.call(this,sql);}finally{const row=metrics[key]??={count:0,wallMs:0};row.count++;row.wallMs+=performance.now()-start;}
};
const cpu=process.cpuUsage(),start=performance.now();
let timerDelayMs=0;const timer=new Promise<void>(resolve=>setTimeout(()=>{timerDelayMs=performance.now()-start;resolve();},10));
try{assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');initDatabase();const db=getDb();const elapsedMs=performance.now()-start;
 await timer;
 assert.equal((db.query('PRAGMA synchronous').get()as{synchronous:number}).synchronous,2);
 assert.equal((db.query('PRAGMA quick_check').get()as{quick_check:string}).quick_check,'ok');
 const schemaSha256=createHash('sha256').update(JSON.stringify(db.query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type,name").all())).digest('hex');
 console.log(JSON.stringify({kind:'startup-contention-profile',existing:process.argv.includes('--existing'),runtime:Bun.version,elapsedMs,timerDelayMs,cpu:process.cpuUsage(cpu),metrics,schemaSha256,tables:(db.query("SELECT count(*) n FROM sqlite_schema WHERE type='table'").get()as{n:number}).n,scope:'ownedZFSWAL/FULL initialization; SQLtext/binds not recorded, execwall includesstatementcommit excluding outertransactioncommit; one10mstimer measures synchronousblocking, no percentile claim; no liveDB/providers'}));
}finally{Database.prototype.exec=original;closeDatabase();}
