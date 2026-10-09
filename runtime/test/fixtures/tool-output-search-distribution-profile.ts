/** Cost-review distributions only. No runtime query changes or live state. */
import assert from 'node:assert/strict';import{performance}from'node:perf_hooks';
import{initDatabase,getDb,closeDatabase}from'../../src/db/connection.js';
import{assertPathWithinTestFilesystemIsolation}from'../../scripts/test-filesystem-isolation.js';
assertPathWithinTestFilesystemIsolation(process.env.PICLAW_STORE!,process.env,{allowRoot:false});assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');
const total=Number(process.argv[2]);assert([10000,100000].includes(total));
initDatabase();const db=getDb();const rows=[];try{
 const insert=db.prepare('INSERT INTO tool_outputs_fts(content,output_id)VALUES(?,?)');
 db.transaction(()=>{for(let n=0;n<total;n++)insert.run(`common marker${Math.floor(n/10)} rare${n} ${n<63?'width63 ':''}${n<64?'width64 ':''}${n<65?'width65 ':''}`,'target-'+Math.floor(n/10));
  for(let n=0;n<1000;n++)insert.run('common large chunk '+n,'target-large');
 }).immediate();
 const base=db.prepare("SELECT snippet(tool_outputs_fts,0,'[',']','…',12)AS snippet FROM tool_outputs_fts WHERE tool_outputs_fts MATCH ? AND output_id=? LIMIT ?");
 const target=db.prepare("SELECT snippet(tool_outputs_fts,0,'[',']','…',12)AS snippet FROM tool_outputs_fts WHERE tool_outputs_fts MATCH ? AND rowid IN(SELECT rowid FROM tool_outputs_fts WHERE output_id=?) LIMIT ?");
 const probe=db.query('SELECT rowid FROM tool_outputs_fts WHERE tool_outputs_fts MATCH ? LIMIT 64');
 for(const [label,id]of[['early','target-0'],['middle','target-'+Math.floor(total/20)],['late','target-'+(total/10-1)],['large','target-large']])for(const query of['common','width63','width64','width65','rare'+(total-1),'missing']){
  const expected=base.all(query,id,5)as any[];
  for(const strategy of['baseline','target-first','adaptive64']){
   const cpu=process.cpuUsage(),start=performance.now();let last:any[]=[],probeMs=0,queryMs=0,probeRows=0;
   for(let run=0;run<10;run++){
    let chosen=base;if(strategy==='target-first')chosen=target;else if(strategy==='adaptive64'){const at=performance.now(),found=probe.all(query);probeMs+=performance.now()-at;probeRows+=found.length;if(found.length===64)chosen=target;}
    const at=performance.now();last=chosen.all(query,id,5)as any[];queryMs+=performance.now()-at;
    assert.equal(last.length,expected.length);if(expected.length<5)assert.deepEqual(last.map(x=>x.snippet).sort(),expected.map(x=>x.snippet).sort());
    assert(last.every(x=>id==='target-large'?x.snippet.includes('large'):x.snippet.includes('marker'+id.slice(7))));
   }
   rows.push({totalCorpusChunks:total+1000,targetPosition:label,targetChunks:label==='large'?1000:10,queryClass:query.startsWith('rare')?'rare':query,strategy,iterations:10,wallMs:performance.now()-start,cpu:process.cpuUsage(cpu),probe:{ms:probeMs,rows:probeRows},queryMs,results:last.length});
  }
 }
 const plans={baseline:db.query('EXPLAIN QUERY PLAN '+base.toString()).all('common','target-0',5),targetFirst:db.query('EXPLAIN QUERY PLAN '+target.toString()).all('common','target-0',5),probe:db.query('EXPLAIN QUERY PLAN '+probe.toString()).all('common')};
 assert.deepEqual(db.query('PRAGMA quick_check').get(),{quick_check:'ok'});
 console.log(JSON.stringify({runtime:Bun.version,rows,plans,scope:'Synthetic query-only controlled FTS distributions; own WAL/FULL database, no publication of raw binds or contents. First/middle/late/large targets,63/64/65global matches,rare and no matches; complete probe all() attribution. Runtime query remains unchanged.'}));
}finally{closeDatabase()}
