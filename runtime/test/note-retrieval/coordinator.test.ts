import {afterEach,beforeEach,expect,setDefaultTimeout,test} from 'bun:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync,renameSync,symlinkSync,linkSync,utimesSync,statSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Database} from 'bun:sqlite';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {markNoteIndexDirty,runNoteIndexPhase} from '../../src/note-retrieval/coordinator.js';
import {withExecutionIdentity} from '../../src/core/execution-context.js';
let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void;
const workspaceEnvKeys=['PICLAW_WORKSPACE','PICLAW_STORE','PICLAW_DATA','PICLAW_DB_IN_MEMORY'] as const;
let previousWorkspaceEnv:Record<string,string|undefined>;
setDefaultTimeout(30_000);
beforeEach(()=>{previousWorkspaceEnv=Object.fromEntries(workspaceEnvKeys.map(key=>[key,process.env[key]]));ws=createTempWorkspace('note-index-376-');restore=setEnv({PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'});Object.assign(process.env,{PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0'});mkdirSync(join(ws.workspace,'notes'),{recursive:true});writeFileSync(join(ws.store,'messages.db'),Buffer.alloc(0));});
afterEach(()=>{restore();for(const key of workspaceEnvKeys){const value=previousWorkspaceEnv[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}ws.cleanup();});
const put=(name:string,content:string)=>{writeFileSync(join(ws.workspace,'notes',name),content);};
const binding=()=>{const paths=[ws.workspace,ws.store,ws.data,join(ws.store,'messages.db')].map(realpathSync),identities=paths.map(p=>{const s=lstatSync(p);return `${s.dev}:${s.ino}`;});return {version:1,mode:'single-user',workspace:paths[0],store:paths[1],data:paths[2],database:paths[3],databaseIdentity:identities[3],identities};};
const database=()=>new Database(join(ws.store,'messages.db'));
async function run(bound:unknown=binding(),rebuild=false,aborted=false){
 const p=spawn(process.execPath,['-e',`const {runNoteIndexPhase}=await import('./src/note-retrieval/coordinator.ts');const controller=new AbortController();if(${aborted})controller.abort();try{await runNoteIndexPhase({rebuild:${rebuild},signal:controller.signal})}catch(e){console.error(e.name+':'+e.message);process.exitCode=1}`],{cwd:resolve(import.meta.dir,'../..'),env:process.env,stdio:['ignore','pipe','pipe','pipe']});
 let errors='';p.stderr!.on('data',b=>errors+=b);(p.stdio[3] as any).end(JSON.stringify(bound));const [code]=await once(p,'exit');return {code,errors:errors.split('\n').filter(line=>!line.startsWith('{"ts"')).join('\n')};
}
const snapshot=()=>{const db=database();try{return db.query('SELECT * FROM note_retrieval_state').get() as any;}finally{db.close();}};
const chunks=()=>{const db=database();try{return db.query('SELECT chunk_id,path,revision,first_byte,after_last_byte,line_start,line_end,content FROM note_retrieval_chunks WHERE generation=(SELECT published FROM note_retrieval_state)').all() as any[];}finally{db.close();}};
const sql=(statement:string,...values:any[])=>{const db=database();try{return db.query(statement).get(...values) as any;}finally{db.close();}};
async function childEval(code:string){const p=spawn(process.execPath,['-e',code],{cwd:resolve(import.meta.dir,'../..'),env:process.env});const [exit]=await once(p,'exit');return exit;}
async function combined(args:string[],bound?:unknown){const p=spawn(process.execPath,['src/workspace-index-process.ts',...args],{cwd:resolve(import.meta.dir,'../..'),env:process.env,stdio:bound===undefined?'ignore':['ignore','ignore','pipe','pipe']});let errors='';if(p.stderr)p.stderr.on('data',b=>errors+=b);if(bound!==undefined)(p.stdio[3] as any).end(JSON.stringify(bound));const [code]=await once(p,'exit');return {code,errors};}
test('worker requires inherited binding before opening note schema',async()=>{
 const r=await run({...binding(),store:join(ws.workspace,'other')});expect(r.code).toBe(1);expect(r.errors).toContain('NoteIndexDenied');
 expect(sql("SELECT name FROM sqlite_master WHERE name='note_retrieval_state'")).toBeNull();
 await expect(runNoteIndexPhase()).rejects.toThrow('Note index access denied');
});
test('database path replacement is denied against both captured binding and an already-open parent instance',async()=>{
 const captured=binding(),dbPath=join(ws.store,'messages.db'),oldPath=join(ws.store,'old-messages.db');renameSync(dbPath,oldPath);writeFileSync(dbPath,Buffer.alloc(0));
 const mismatched=await run(captured);expect(mismatched.code).toBe(1);expect(mismatched.errors).toContain('NoteIndexDenied');expect(sql("SELECT name FROM sqlite_master WHERE name='note_retrieval_state'")).toBeNull();
 unlinkSync(dbPath);renameSync(oldPath,dbPath);expect((await run()).code).toBe(0);
 const child=`const fs=await import('node:fs');const {initDatabase}=await import('./src/db/connection.ts');const {markNoteIndexDirty}=await import('./src/note-retrieval/coordinator.ts');initDatabase();fs.renameSync(${JSON.stringify(dbPath)},${JSON.stringify(oldPath)});fs.writeFileSync(${JSON.stringify(dbPath)},Buffer.alloc(0));try{markNoteIndexDirty(['notes/a.md']);process.exitCode=2}catch(e){process.exitCode=e.name==='NoteIndexDenied'?0:3}finally{fs.unlinkSync(${JSON.stringify(dbPath)});fs.renameSync(${JSON.stringify(oldPath)},${JSON.stringify(dbPath)})}`;
 expect(await childEval(child)).toBe(0);
});
test('combined worker runs note and legacy phases only with explicit fd binding marker',async()=>{
 put('a.md','alpha combined');
 expect((await combined(['--scope','notes','--expected-mode','single-user'])).code).toBe(0);
 expect(sql("SELECT name FROM sqlite_master WHERE name='note_retrieval_state'")).toBeNull();
 expect(sql("SELECT count(*) n FROM workspace_files")).toEqual({n:1});
 expect((await combined(['--scope','notes','--note-binding-fd','3','--expected-mode','single-user'],binding())).code).toBe(0);
 expect(snapshot().state).toBe('ready');expect(chunks()).toHaveLength(1);
 expect((await combined(['--scope','notes','--note-binding-fd','3','--expected-mode','single-user'])).code).toBe(1);
 expect((await combined(['--scope','skills','--note-binding-fd','3','--expected-mode','single-user'],binding())).code).toBe(0);
 expect(snapshot().sequence).toBe(1);
});
test('versioned atomic snapshots preserve unchanged IDs, detect same-metadata edits, move/delete and rebuild',async()=>{
 put('a.md','# One\r\nalpha\r\n');put('b.md','## Other\nunchanged');
 let r=await run();expect(r.errors).toBe('');expect(r.code).toBe(0);expect(snapshot().state).toBe('ready');
 const initial=chunks();expect(initial).toHaveLength(2);const first=snapshot();
 expect((await run()).code).toBe(0);expect(chunks().map(c=>c.chunk_id)).toEqual(initial.map(c=>c.chunk_id));expect(snapshot().namespace).toBe(first.namespace);
 const file=join(ws.workspace,'notes','a.md'),stat=statSync(file);put('a.md','# One\r\nbravo\r\n');utimesSync(file,stat.atime,stat.mtime);
 expect((await run()).code).toBe(0);expect(chunks().find(c=>c.path==='notes/a.md').chunk_id).not.toBe(initial[0].chunk_id);expect(chunks().find(c=>c.path==='notes/b.md').chunk_id).toBe(initial[1].chunk_id);
 renameSync(file,join(ws.workspace,'notes','renamed.md'));unlinkSync(join(ws.workspace,'notes','b.md'));
 expect((await run()).code).toBe(0);expect(chunks()).toHaveLength(1);expect(chunks()[0].path).toBe('notes/renamed.md');
 const old=chunks()[0].chunk_id;expect((await run(binding(),true)).code).toBe(0);expect(chunks()[0].chunk_id).not.toBe(old);
 expect(snapshot().staging).toBeNull();expect(sql('SELECT count(DISTINCT generation) n FROM note_retrieval_sources')).toEqual({n:1});
});
test('excluded private roots, symlinks, hardlinks, invalid UTF8 and oversized files cannot publish',async()=>{
 put('good.md','good');mkdirSync(join(ws.workspace,'notes','users'));mkdirSync(join(ws.workspace,'notes','family'));put('users/private.md','private');put('family/shared.md','shared');
 put('bad.md','valid initially');expect((await run()).code).toBe(0);
 writeFileSync(join(ws.workspace,'notes','bad.md'),Buffer.from([255]));put('large.md','x'.repeat(512*1024+1));symlinkSync(join(ws.workspace,'notes','good.md'),join(ws.workspace,'notes','link.md'));put('hard.md','hard');linkSync(join(ws.workspace,'notes','hard.md'),join(ws.workspace,'notes','hard2.md'));
 expect((await run()).code).toBe(0);expect(snapshot().state).toBe('limited');expect(chunks().map(c=>c.path)).toEqual(['notes/good.md']);
 expect(sql('SELECT count(*) n FROM note_retrieval_fts')).toEqual({n:1});
});
test('dirty generation and overdue status are independent of legacy index ready status',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const old=snapshot();
 expect(await childEval(`const {markNoteIndexDirty}=await import('./src/note-retrieval/coordinator.ts');const {initDatabase}=await import('./src/db/connection.ts');initDatabase();markNoteIndexDirty(['notes/new.md'])`)).toBe(0);expect(snapshot().dirty).toBe(old.dirty+1);expect(snapshot().state).toBe('stale');
 expect((await run()).code).toBe(0);{const db=database();db.query('UPDATE note_retrieval_state SET last_complete=?').run(Date.now()+60000);db.close();}expect(await childEval(`const {noteIndexStatus}=await import('./src/note-retrieval/coordinator.ts');const {initDatabase}=await import('./src/db/connection.ts');initDatabase();process.exit(noteIndexStatus().state==='stale'?0:1)`)).toBe(0);
});
test('dirty incremental refresh preserves unaffected IDs and defers unknown external additions to a full reconciliation',async()=>{
 put('a.md','alpha');put('b.md','beta');expect((await run()).code).toBe(0);const before=chunks();
 put('a.md','ALPHA');put('external.md','new external note');
 expect(await childEval(`const {markNoteIndexDirty}=await import('./src/note-retrieval/coordinator.ts');const {initDatabase}=await import('./src/db/connection.ts');initDatabase();markNoteIndexDirty(['notes/a.md'])`)).toBe(0);
 expect((await run()).code).toBe(0);const incremental=chunks();expect(incremental.find(c=>c.path==='notes/a.md').chunk_id).not.toBe(before.find(c=>c.path==='notes/a.md').chunk_id);expect(incremental.find(c=>c.path==='notes/b.md').chunk_id).toBe(before.find(c=>c.path==='notes/b.md').chunk_id);expect(incremental.some(c=>c.path==='notes/external.md')).toBe(false);
 {const db=database();db.query('UPDATE note_retrieval_state SET last_complete=?').run(Date.now()-300001);db.close();}
 expect((await run()).code).toBe(0);expect(chunks().some(c=>c.path==='notes/external.md')).toBe(true);
});
test('live writer cannot be reclaimed; crash-left staging is reclaimed before successor',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const published=snapshot().published;
 {const db=database();db.query('UPDATE note_retrieval_state SET staging=999,writer_pid=?').run(process.pid);db.close();}
 expect((await run()).code).toBe(1);expect(snapshot().published).toBe(published);
 {const db=database();db.query('UPDATE note_retrieval_state SET writer_pid=2147483647').run();db.query("INSERT INTO note_retrieval_sources VALUES(999,'notes/abandoned.md','rev',1,1,0)").run();db.close();}
 expect((await run()).code).toBe(0);expect(sql('SELECT count(*) n FROM note_retrieval_sources WHERE generation=999')).toEqual({n:0});
});
test('SQL fault rolls back staging, retains publication and never deletes source/other tables',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const previous=chunks();
 {const db=database();db.exec("CREATE TABLE fixture_other(value TEXT); INSERT INTO fixture_other VALUES('keep'); CREATE TRIGGER note_fault BEFORE INSERT ON note_retrieval_chunks BEGIN SELECT RAISE(ABORT,'fixture fault'); END;");db.close();}put('a.md','bravo');
 expect((await run()).code).toBe(1);expect(chunks()).toEqual(previous);expect(snapshot().staging).toBeNull();expect(sql('SELECT value FROM fixture_other')).toEqual({value:'keep'});expect(readFileSync(join(ws.workspace,'notes','a.md'),'utf8')).toBe('bravo');
});
test('cancelled refresh cleans its only staging slot and preserves publication',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const publication=snapshot().published,previous=chunks();put('a.md','bravo');
 expect((await run(binding(),false,true)).code).toBe(1);expect(snapshot().published).toBe(publication);expect(snapshot().staging).toBeNull();expect(chunks()).toEqual(previous);
});
test('failed abandoned-stage cleanup blocks a successor and leaves the publication intact',async()=>{
 put('a.md','alpha');expect((await run()).code).toBe(0);const publication=snapshot().published;
 {const db=database();db.query('UPDATE note_retrieval_state SET staging=999,writer_pid=2147483647').run();db.query("INSERT INTO note_retrieval_sources VALUES(999,'notes/abandoned.md','rev',1,1,0)").run();db.exec("CREATE TRIGGER cleanup_fault BEFORE DELETE ON note_retrieval_sources WHEN old.generation=999 BEGIN SELECT RAISE(ABORT,'cleanup fault'); END;");db.close();}
 expect((await run()).code).toBe(1);expect(snapshot().published).toBe(publication);expect(snapshot().staging).toBe(999);expect(sql('SELECT count(*) n FROM note_retrieval_sources WHERE generation=999')).toEqual({n:1});
});
test('stale/malformed family identity denies before selectors are inspected',()=>{
 const identity:any=Object.freeze({mode:'family-shared',provenance:Object.freeze({})});let touched=false;
 withExecutionIdentity(identity,()=>expect(()=>markNoteIndexDirty(new Proxy([],{get(){touched=true;throw Error('selector accessed');}}))).toThrow('Note index access denied'));
 expect(touched).toBe(false);
});
