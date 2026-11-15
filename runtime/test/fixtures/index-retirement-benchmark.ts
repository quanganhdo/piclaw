import Database from 'bun:sqlite';
import {readFileSync,writeFileSync,mkdtempSync,copyFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const start=performance.now();
const repo=resolve(import.meta.dir,'../../..');
const profile=process.argv[2] ?? 'attachment';
const reportPath=process.argv[3];
if(!['attachment','all-candidates'].includes(profile)||!reportPath) throw Error('Usage: isolated launcher -- bun index-retirement-benchmark.ts attachment|all-candidates <report.json>');
function assert(x:any,m:string):asserts x {if(!x)throw Error(m)}
assert(process.env.PICLAW_TEST_FS_ISOLATION_ACTIVE==='1','launcher required');
assert(process.env.PICLAW_DB_IN_MEMORY==='0','file mode required');
const root=resolve(process.env.PICLAW_TEST_FS_ISOLATION_ROOT!);
const tmp=resolve(process.env.TMPDIR!);
assert(tmp.startsWith(root+'/') && tmp.endsWith('/tmp'),'owned launcher tmp required');
const dir=mkdtempSync(join(tmp,'index1689-'));
const files=['runtime/src/db/connection.ts','runtime/src/db/media.ts','runtime/src/db/extension-kv.ts','runtime/src/db/token-usage.ts','runtime/src/db/chat-branches.ts','runtime/skills/operator/token-chart/token-usage-by-provider-model-chart.ts','runtime/scripts/local-test-priority.ts','runtime/scripts/test-filesystem-isolation.ts','runtime/src/db/attachment-index-retirement.ts'];
const sources=Object.fromEntries(files.map(f=>[f,readFileSync(join(repo,f),'utf8')]));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const conn=sources[files[0]], media=sources[files[1]], kv=sources[files[2]], usage=sources[files[3]], branches=sources[files[4]], chart=sources[files[5]];
const ddl=conn.match(/function createSchema\(database: Database\): void \{\s*database.exec\(`([\s\S]*?)`\);\s*\}/)![1];
assert(ddl&&!ddl.includes('${'),'exact literal DDL extraction failed');
const unique='CREATE UNIQUE INDEX IF NOT EXISTS idx_token_usage_usage_event_id ON token_usage(usage_event_id) WHERE usage_event_id IS NOT NULL';
assert(conn.includes(unique),'usage index mismatch');
const removed=profile==='all-candidates'?['idx_message_media_message_rowid','idx_extension_kv_ext_scope','idx_token_usage_chat_jid']:['idx_message_media_message_rowid'];
const preserved=[...(profile==='attachment'?['idx_extension_kv_ext_scope','idx_token_usage_chat_jid']:[]),'sqlite_autoindex_message_media_1','sqlite_autoindex_extension_kv_1','idx_token_usage_chat_jid_run_at','idx_messages_chat_jid'];
function open(p:string){const db=new Database(p);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; PRAGMA mmap_size=268435456; PRAGMA cache_size=-1000; PRAGMA foreign_keys=OFF;');return db}
const seedPath=join(dir,'seed.db');let seed=open(seedPath);seed.exec(ddl);seed.exec('CREATE INDEX IF NOT EXISTS idx_message_media_message_rowid ON message_media(message_rowid)');seed.exec(unique);
const chat=(i:number)=>'synthetic:chat:'+String(i).padStart(4,'0');
const ext=(i:number)=>'synthetic.extension.'+String(i).padStart(3,'0');
const key=(i:number)=>'settings.preference.'+String(i).padStart(4,'0')+'.'+'synthetic-key-'.repeat(4);
const stamp='2025-01-01T00:00:00.000Z';
function kvArgs(e:number,k:number){return [ext(e),k%10===0?'global':'chat',k%10===0?'':chat(k%20),key(k),JSON.stringify({enabled:k%2===0,payload:'synthetic-value-'.repeat(8)})]}
const insertUsage=usage.match(/`(INSERT OR IGNORE INTO token_usage \([\s\S]*?\) VALUES \([? ,]+\))`/)![1];
function usageArgs(i:number){const c=i%10===0?0:1+(i*17%499);const t=new Date(Date.UTC(2025,0,1)+(i*7919%7776000)*1000).toISOString();return [chat(c),t,100+i%1000,10+i%50,3,25,5,1,1,140+i%1050,0.125,0.0625,0.03125,0.015625,0.234375,null,0.234375,'catalogue_estimate','synthetic-model-'+i%3,null,'synthetic-provider-'+i%2,'synthetic-api','assistant',1,null,null,null,null,null,null,null,null,null,null,null,null,null]}
seed.transaction(()=>{
 const c=seed.prepare('INSERT INTO chats(jid,name) VALUES (?,?)');for(let i=0;i<500;i++)c.run(chat(i),'Synthetic '+i);
 const m=seed.prepare('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)');for(let i=0;i<25000;i++)m.run('synthetic-message-'+i,chat(i%500),'synthetic message',stamp);
 const b=seed.prepare('INSERT INTO media(id,filename,content_type,data,metadata,created_at) VALUES (?,?,?,?,?,?)');for(let i=1;i<=40000;i++)b.run(i,'synthetic-'+i+'.bin','application/octet-stream',new Uint8Array(256),'{"synthetic":true}',stamp);
 const a=seed.prepare('INSERT OR IGNORE INTO message_media(message_rowid,media_id) VALUES (?,?)');for(let i=0;i<50000;i++)a.run(1+Math.floor(i/2),1+i%40000);
 const k=seed.prepare('INSERT INTO extension_kv(extension_id,scope,scope_key,key,value,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');for(let e=0;e<75;e++)for(let n=0;n<900;n++)k.run(...kvArgs(e,n),stamp,stamp);
 const u=seed.prepare(insertUsage);for(let i=0;i<80000;i++)u.run(...usageArgs(i));
})();
seed.exec('ANALYZE; PRAGMA wal_checkpoint(PASSIVE)');seed.close();
console.log('fixture populated',Math.round(performance.now()-start),'ms');
const variants:any={};
for(const name of ['baseline','candidate']){const p=join(dir,name+'.db');copyFileSync(seedPath,p);const db=open(p);const before=db.query("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all();if(name==='candidate'){for(const n of removed)db.exec('DROP INDEX '+n)}
 const names=new Set((db.query("SELECT name FROM sqlite_master WHERE type='index'").all() as any[]).map(x=>x.name));for(const n of preserved)assert(names.has(n),'lost '+n);
 db.exec('PRAGMA wal_checkpoint(PASSIVE)');variants[name]={db,path:p,indexesBefore:before,indexesAfter:[...names],stats:{},plans:{},digests:{},writes:{}};
}
function literal(s:string,sql:string){assert(s.includes(sql),'SQL differs from source: '+sql.slice(0,65));return sql}
const aggregate=usage.slice(usage.indexOf('export function getTokenUsageTotals')).match(/`(SELECT[\s\S]*?)`/)![1];
const dateSQL=chart.match(/`(SELECT substr\(run_at[\s\S]*?ORDER BY day, tokens DESC)`/)![1];
const countSQL=literal(kv,'SELECT COUNT(*) as cnt FROM extension_kv WHERE extension_id = ?');
const existsSQL=literal(kv,'SELECT 1 FROM extension_kv WHERE extension_id = ? AND scope = ? AND scope_key = ? AND key = ?');
const upsert=kv.slice(kv.indexOf('export function extensionKvSet')).match(/prepare\(`([\s\S]*?)`\)/)![1];
const queries=[
 {name:'attachment_single',sql:literal(media,'SELECT media_id FROM message_media WHERE message_rowid = ? ORDER BY media_id'),args:(i:number)=>[1+i*173%25000],ops:400},
 {name:'attachment_batch_50',sql:'SELECT DISTINCT media_id FROM message_media WHERE message_rowid IN ('+Array(50).fill('?').join(',')+')',args:(i:number)=>Array.from({length:50},(_,j)=>1+(i*173+j*37)%25000),ops:30},
 {name:'kv_count_900',sql:countSQL,args:(i:number)=>[ext(i%75)],ops:300},
 {name:'kv_scoped_list',sql:literal(kv,'SELECT key FROM extension_kv WHERE extension_id = ? AND scope = ? AND scope_key = ? ORDER BY key'),args:(i:number)=>[ext(i%75),'chat',chat(1+i%9)],ops:100},
 {name:'kv_scoped_prefix',sql:literal(kv,'SELECT key FROM extension_kv WHERE extension_id = ? AND scope = ? AND scope_key = ? AND key LIKE ? ORDER BY key'),args:(i:number)=>[ext(i%75),'chat',chat(1+i%9),'settings.preference.01%'],ops:100},
 {name:'usage_chat_aggregate_hot',sql:aggregate,args:()=>[chat(0)],ops:5},
 {name:'usage_chat_aggregate_typical',sql:aggregate,args:(i:number)=>[chat(1+i%499)],ops:50},
 {name:'usage_chat_count_hot',sql:literal(branches,'SELECT COUNT(*) AS count FROM token_usage WHERE chat_jid = ?'),args:()=>[chat(0)],ops:50},
 {name:'usage_chat_count_typical',sql:'SELECT COUNT(*) AS count FROM token_usage WHERE chat_jid = ?',args:(i:number)=>[chat(1+i%499)],ops:200},
 {name:'usage_date_filter_real_chart',sql:dateSQL,args:()=>['2025-03-25T00:00:00Z'],ops:2},
 {name:'usage_chat_date_count_probe',sql:'SELECT COUNT(*) AS count FROM token_usage WHERE chat_jid = ? AND run_at >= ? AND run_at <= ?',args:()=>[chat(0),'2025-02-01T00:00:00.000Z','2025-03-01T00:00:00.000Z'],ops:50}
];
assert(media.includes('SELECT DISTINCT media_id FROM message_media WHERE message_rowid IN (${placeholders})'),'batch source mismatch');
function canonical(rows:any[]){return rows.map(r=>JSON.stringify(r)).sort().join('\n')}
function digest(db:Database,q:any){return hash(Array.from({length:40},(_,i)=>canonical(db.prepare(q.sql).all(...q.args(i)))).join('\n'))}
const rounds=24;
for(const q of queries){
 for(const [name,v] of Object.entries(variants) as any){v.plans[q.name]=v.db.prepare('EXPLAIN QUERY PLAN '+q.sql).all(...q.args(0));v.digests[q.name]=digest(v.db,q);v.stats[q.name]=[];v[q.name]=v.db.prepare(q.sql)}
 assert(variants.baseline.digests[q.name]===variants.candidate.digests[q.name],'result mismatch '+q.name);
 for(let r=-3;r<rounds;r++)for(const name of ((r&1)?['candidate','baseline']:['baseline','candidate'])){const v=variants[name],s=v[q.name];const t=performance.now();let n=0;for(let i=0;i<q.ops;i++)n+=s.all(...q.args((r+3)*q.ops+i)).length;const us=(performance.now()-t)*1000/q.ops;if(r>=0)v.stats[q.name].push(us);assert(n>=q.ops,'unexpected empty result '+q.name)}
 console.log('read complete',q.name);
}
function tableDigest(db:Database,table:string){const cols=(db.query('PRAGMA table_info('+table+')').all() as any[]).map(x=>x.name).filter(n=>!['created_at','updated_at'].includes(n));return hash(canonical(db.query('SELECT '+cols.join(',')+' FROM '+table).all()))}
const logicalBefore:any={};for(const table of ['message_media','extension_kv','token_usage']){logicalBefore[table]=tableDigest(variants.baseline.db,table);assert(logicalBefore[table]===tableDigest(variants.candidate.db,table),'initial fixture mismatch')}
// Same committed SQL batch on both fixtures; cleanup outside timer restores logical state.
const writeOps=200;
for(const kind of ['attachment_insert','kv_set_existing_with_count','kv_set_new_with_count','usage_insert']){
 for(const v of Object.values(variants) as any[]){if(v.ws)for(const s of Object.values(v.ws) as any[])s.finalize();v.writes[kind]=[];v.ws={a:v.db.prepare(literal(media,'INSERT OR IGNORE INTO message_media (message_rowid, media_id) VALUES (?, ?)')),k:v.db.prepare(upsert),count:v.db.prepare(countSQL),exists:v.db.prepare(existsSQL),u:v.db.prepare(insertUsage)}}
 for(let r=-2;r<20;r++)for(const name of ((r&1)?['candidate','baseline']:['baseline','candidate'])){const v=variants[name],db=v.db,s=v.ws;const t=performance.now();db.transaction(()=>{for(let i=0;i<writeOps;i++){
 if(kind==='attachment_insert')s.a.run(30000+i,1+i);
 else if(kind.startsWith('kv_set')){const a=kvArgs(i%75,kind==='kv_set_new_with_count'?900+Math.floor(i/75):1+Math.floor(i/75));const c=s.count.get(a[0]) as any;const exists=s.exists.get(...a.slice(0,4));assert(exists||c.cnt<1000,'KV limit');s.k.run(...a)}
 else s.u.run(...usageArgs(80000+i));
 }})();const us=(performance.now()-t)*1000/writeOps;if(r>=0)v.writes[kind].push(us);
 if(kind==='attachment_insert')db.exec('DELETE FROM message_media WHERE message_rowid>=30000');
 if(kind==='kv_set_new_with_count')db.exec("DELETE FROM extension_kv WHERE key >= 'settings.preference.0900.'");
 if(kind==='usage_insert')db.exec('DELETE FROM token_usage WHERE id>80000');
 }
 console.log('write complete',kind);
}
function dist(xs:number[]){const s=[...xs].sort((a,b)=>a-b);const p=(q:number)=>s[Math.ceil(q*s.length)-1];return {n:s.length,min:s[0],p10:p(.1),median:p(.5),p90:p(.9),p95:p(.95),max:s.at(-1),mean:s.reduce((a,b)=>a+b,0)/s.length,raw:xs}}
const output:any={issue:1689,profile,sourceCommit:Bun.spawnSync(['git','rev-parse','HEAD'],{cwd:repo}).stdout.toString().trim(),worktreeStatus:Bun.spawnSync(['git','status','--porcelain'],{cwd:repo}).stdout.toString().trim(),sourceHashes:Object.fromEntries(Object.entries(sources).map(([f,s])=>[f,hash(s)])),scriptSha256:hash(readFileSync(import.meta.path,'utf8')),schemaMode:'Exact complete createSchema literal plus historical attachment-only index and partial usage-event unique index; not core init. No live DB accessed.',fixture:{synthetic:true,attachments:50000,messages:25000,media:40000,extensions:75,keysPerExtension:900,kvRows:67500,usage:80000,chats:500,hotChatRows:8000,kvKeyBytes:key(1).length,mediaBlobBytes:256},isolation:{root,fixtureDirectory:dir,cleanup:'central launcher removes entire owned root after exit'},method:{readRounds:rounds,readWarmupRounds:3,alternatingOrder:true,units:'microseconds per SQL operation (batch amortized)',writeRounds:20,writeWarmupRounds:2,writeBatchOperations:writeOps,writeTransactions:'committed batches; cleanup excluded from timing; same deterministic inputs; KV count + existence + UPSERT every set',analyze:'once on identical seed before clone; no re-ANALYZE after dropping indexes',sql:queries.map(q=>({name:q.name,sql:q.sql,exampleArgs:q.args(0),operationsPerRound:q.ops,source:q.name==='usage_chat_date_count_probe'?'supplemental synthetic conjunction probe, NOT claimed source SQL':'source SQL; attachment batch substitutes 50 placeholders'})),writeSQL:{attachment:variants.baseline.ws.a.toString(),kvCount:countSQL,kvExists:existsSQL,kvUpsert:upsert,usage:insertUsage}},preserved,removedInCandidate:removed,variants:{},comparisons:{reads:{},writes:{}},logicalBefore,limitations:['Single-process offline synthetic warm-cache measurements, not production performance or concurrent lock testing.','No cold-cache or fsync-per-operation latency claim; batches commit under FULL durability; synchronous=FULL, WAL and mmap explicitly configured.','Exact createSchema literal plus historical attachment index, not full core migrations/init; unrelated migration schemas omitted.','Aggregate float costs use exact binary fractions to make deterministic digest comparison reliable.','Read digest canonicalizes unordered SQL rows; no ordering claim for DISTINCT batch results.','KV count index is narrower than PK; left-prefix coverage alone does not establish equal scan cost.','Committed write cleanup excluded; physical freelist/cache state may drift identically; SQL-only, excludes JS serialization, compression, budget side effects and FTS attachment extraction.','Final fileBytes excludes outstanding WAL; walBytes and page/freelist counts reported separately, no compacted-size savings claim.','Chat/date combined count is a supplemental probe; real chat count and chart date-filter SQL also measured.']};
for(const [name,v] of Object.entries(variants) as any){for(const s of Object.values(v.ws) as any[])s.finalize();const after:any={};for(const table of Object.keys(logicalBefore)){after[table]=tableDigest(v.db,table);assert(after[table]===logicalBefore[table],'write cleanup logical mismatch '+name+' '+table)}output.variants[name]={indexesBefore:v.indexesBefore,indexesAfter:v.indexesAfter,plans:v.plans,digests:v.digests,logicalAfter:after,reads:Object.fromEntries(Object.entries(v.stats).map(([k,x])=>[k,dist(x as number[])])),writes:Object.fromEntries(Object.entries(v.writes).map(([k,x])=>[k,dist(x as number[])])),pragmas:Object.fromEntries(['journal_mode','synchronous','page_size','page_count','freelist_count','cache_size','mmap_size','secure_delete'].map(p=>[p,v.db.query('PRAGMA '+p).get()])),fileBytes:statSync(v.path).size,walBytes:(()=>{try{return statSync(v.path+'-wal').size}catch{return 0}})(),sqliteVersion:v.db.query('SELECT sqlite_version() AS version').get(),bunVersion:Bun.version};v.db.close()}
for(const section of ['reads','writes'])for(const k of Object.keys(output.variants.baseline[section])){const a=output.variants.baseline[section][k],b=output.variants.candidate[section][k];const ratios=a.raw.map((x:number,i:number)=>b.raw[i]/x);output.comparisons[section][k]={baselineMedianUs:a.median,candidateMedianUs:b.median,medianChangePercent:100*(b.median/a.median-1),pairedRatio:dist(ratios),candidateSlowerRounds:ratios.filter((x:number)=>x>1).length}}
output.elapsedSeconds=(performance.now()-start)/1000;
for(const f of files)assert(hash(readFileSync(join(repo,f),'utf8'))===output.sourceHashes[f],'source changed during benchmark: '+f);
output.correctness='PASS: all query digests match before/after dropping candidate indexes; table-content digests (excluding created_at/updated_at timestamps) match initially and after committed write cleanup; protected indexes asserted';
const kvc=output.comparisons.reads.kv_count_900;
output.decisionSupport={attachment:'PK is covering for measured single/batch SQL; assess measured deltas, parent decides migration.',kv:profile==='attachment'?'KV index retained in this selected profile; removal decision uses the separate all-candidates run.':kvc.medianChangePercent>5?'Measurable count regression in this fixture: retain idx_extension_kv_ext_scope or separately evaluate a narrower extension_id count index; parent owns tradeoff.':'No >5% median KV count regression here; narrower count-index exception remains workload/cache dependent.',usage:profile==='attachment'?'Chat-only usage index retained in this selected profile; removal decision uses the separate all-candidates run.':'Composite supports measured queries; compare hot aggregate and narrow chat-count deltas before retirement. No source retirement performed.'};
writeFileSync(reportPath,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({reportPath,elapsedSeconds:output.elapsedSeconds,correctness:output.correctness,comparisons:output.comparisons,decisionSupport:output.decisionSupport},null,2));
