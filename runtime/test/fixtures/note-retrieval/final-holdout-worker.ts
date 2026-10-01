/** Final frozen holdout: registered tools, role-labelled evidence, no answer model. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {getActiveTestFilesystemIsolationRoot,assertPathWithinTestFilesystemIsolation} from '../../../scripts/test-filesystem-isolation.js';
import {admittedNotePath} from '../../../src/note-retrieval/files.js';
if(!getActiveTestFilesystemIsolationRoot())throw Error('Isolated launcher required');
const workspace=process.env.PICLAW_WORKSPACE!,store=process.env.PICLAW_STORE!,data=process.env.PICLAW_DATA!;
for(const path of [workspace,store,data])assertPathWithinTestFilesystemIsolation(path);
process.env.PICLAW_DB_IN_MEMORY='0';process.env.PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX='1';
const root=join(import.meta.dir,'final-holdout'),bytes=readFileSync(join(root,'corpus.json'));
const freeze=JSON.parse(readFileSync(join(root,'freeze.json'),'utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),freeze.corpusSha256);
const fixture=JSON.parse(bytes.toString('utf8')) as {notes:Array<{path:string;text:string}>,queries:Array<{id:string;question:string;query:string;expectedRole:string;evidence:Array<{path:string;quote:string}>;forbiddenClaims:string[]}>};
assert.equal(new Set(fixture.notes.map(n=>n.path)).size,fixture.notes.length);
assert.equal(new Set(fixture.queries.map(q=>q.id)).size,fixture.queries.length);
for(const note of fixture.notes){
 assert.ok(admittedNotePath(note.path));const path=join(workspace,note.path);assertPathWithinTestFilesystemIsolation(path);
 mkdirSync(dirname(path),{recursive:true});writeFileSync(path,note.text);
}
for(const q of fixture.queries){
 assert.ok(['supported','contradicted','unrecorded','absent'].includes(q.expectedRole),q.id);
 assert.equal(q.evidence.length===0,q.expectedRole==='absent',q.id);
 assert.ok(Array.isArray(q.forbiddenClaims)&&q.forbiddenClaims.every(s=>typeof s==='string'),q.id);
 for(const e of q.evidence)assert.ok(fixture.notes.some(n=>n.path===e.path&&n.text.includes(e.quote)),q.id);
}
mkdirSync(join(workspace,'.piclaw'),{recursive:true});writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));
const {initDatabase,closeDatabase}=await import('../../../src/db/connection.js');initDatabase();
const {captureNoteIndexBinding}=await import('../../../src/note-retrieval/access.js');
const child=spawn(process.execPath,['-e',"const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');await runNoteIndexPhase();"],{cwd:join(import.meta.dir,'../../..'),env:process.env,stdio:['ignore','ignore','pipe','pipe']});
const exited=once(child,'exit');let errors='';child.stderr!.on('data',b=>errors+=b);(child.stdio[3] as any).end(JSON.stringify(captureNoteIndexBinding()));
const [exit]=await exited;assert.equal(exit,0,errors);
const {createMemorySearchExtension}=await import('../../../src/extensions/memory-search.js');
const {createFakeExtensionApi}=await import('../../extensions/fake-extension-api.js');
const {withChatContext}=await import('../../../src/core/chat-context.js');
const fake=createFakeExtensionApi({activeTools:['memory_query','memory_get']});createMemorySearchExtension('web:final-holdout')(fake.api);
const ctx:any={cwd:workspace,sessionManager:{getSessionId:()=> 'final-holdout'}};
await fake.handlers.find(h=>h.event==='session_start')!.handler({},ctx);
const invoke=async(name:string,params:unknown)=>{
 const r=await withChatContext('web:final-holdout','web',()=>fake.tools.get(name).execute(name,params,undefined,undefined,ctx));
 return {body:JSON.parse(r.content[0].text),bytes:Buffer.byteLength(JSON.stringify(r))};
};
try{
 const results=[];
 for(const q of fixture.queries){
  const started=performance.now(),response=await invoke('memory_query',{query:q.query,limit:freeze.maxHits}),r=response.body;
  assert.ok(['ok','partial'].includes(r.status),q.id+':'+r.status);assert.ok(response.bytes<=freeze.maxResponseBytes);
  const delivered:Array<{path:string;text:string}>=[],fetched:Array<{path:string;text:string}>=[];
  let references=0;
  for(const hit of r.hits){
   const refs=[...(hit.context??[]),hit];let context='';
   for(const ref of refs){
    const got=(await invoke('memory_get',{chunk_id:ref.chunk_id,source_revision:ref.source_revision})).body;
    assert.equal(got.status,'ok',q.id);assert.equal(got.path,ref.path);assert.equal(got.source_revision,ref.source_revision);
    assert.equal(got.line_start,ref.line_start);assert.equal(got.line_end,ref.line_end);
    if(ref===hit){assert.ok(got.text.includes(hit.snippet));fetched.push({path:hit.path,text:context+got.text});}
    else {assert.equal(got.text,ref.text);context+=ref.text;}
    references++;
   }
   delivered.push({path:hit.path,text:context+hit.snippet});
  }
  const covered=(texts:Array<{path:string;text:string}>)=>q.evidence.length>0&&q.evidence.every(e=>texts.some(t=>t.path===e.path&&t.text.includes(e.quote)));
  results.push({id:q.id,query:q.query,expectedRole:q.expectedRole,status:r.status,reasons:r.reasons,hitCount:r.hits.length,
   deliveredEvidence:covered(delivered),getEvidence:covered(fetched),references,bytes:response.bytes,elapsedMs:performance.now()-started,
   delivered,fetched,forbiddenClaims:q.forbiddenClaims,answerAccuracy:'not evaluated; no model answer generated'});
 }
 console.log('FINAL_HOLDOUT_REPORT='+JSON.stringify({corpusSha256:freeze.corpusSha256,results}));
}finally{closeDatabase();}
