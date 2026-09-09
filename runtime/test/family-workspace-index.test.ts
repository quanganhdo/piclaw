import { afterEach,beforeEach,expect,test,spyOn } from 'bun:test';
import fs from 'node:fs/promises';
import { mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTempWorkspace,setEnv } from './helpers.js';
import { initDatabase,getDb,closeDatabase } from '../src/db/connection.js';
import { searchWorkspace,refreshWorkspaceIndex,getWorkspaceIndexStatus,markWorkspaceIndexStale,setBackgroundWorkspaceIndexRefreshRequesterForTests } from '../src/workspace-search.js';
import { normalizeWorkspaceIndexRoots } from '../src/workspace-index-core.js';
import { WorkspaceIndexAccessDenied } from '../src/core/workspace-index-access.js';
import { withExecutionIdentity,type ExecutionIdentity } from '../src/core/execution-context.js';
import { launchWorkspaceIndexProcess,runWorkspaceIndexProcessFromArgs,setWorkspaceIndexSpawnForTests,resetWorkspaceIndexLauncherForTests } from '../src/workspace-index-process.js';
import { EventEmitter } from 'node:events';

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void;
const config=(mode:string,roots:string[]=[])=>(writeFileSync(path.join(ws.workspace,'.piclaw/config.json'),mode==='invalid'?'{':JSON.stringify({domains:{access:{mode},tools:{workspaceSearchRoots:roots}}})));
async function file(name:string,text:string){await fs.mkdir(path.dirname(path.join(ws.workspace,name)),{recursive:true});await fs.writeFile(path.join(ws.workspace,name),text);}
const snapshot=()=>JSON.stringify(['workspace_files','workspace_fts','workspace_index_status','family_workspace_files','family_workspace_fts','family_workspace_index_status'].map(table=>getDb().query(`SELECT * FROM ${table} ORDER BY rowid`).all()));
beforeEach(()=>{
  ws=createTempWorkspace('family-index-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:undefined});
  mkdirSync(path.join(ws.workspace,'.piclaw'));config('single-user');closeDatabase();initDatabase();setBackgroundWorkspaceIndexRefreshRequesterForTests(()=>{});resetWorkspaceIndexLauncherForTests();
});
afterEach(()=>{setBackgroundWorkspaceIndexRefreshRequesterForTests(null);resetWorkspaceIndexLauncherForTests();closeDatabase();restore();ws.cleanup();});

test('family uses separate empty index despite legacy ready status, then indexes only explicit family and skill roots',async()=>{
  await file('notes/users/alice/MEMORY.md','alpha PERSONAL_ALICE');await file('notes/users/bob/preferences.md','alpha PERSONAL_BOB');await file('notes/memory/MEMORY.md','alpha LEGACY_PERSONAL');await file('notes/family/MEMORY.md','alpha SHARED_FAMILY');await file('.pi/skills/shared/SKILL.md','alpha SHARED_SKILL');await file('extra/private.md','alpha EXTRA_PRIVATE');
  config('single-user',['notes','.pi/skills','extra']);await refreshWorkspaceIndex();expect((await searchWorkspace({query:'alpha'})).rows).toHaveLength(6);
  const legacy=getDb().query('SELECT * FROM workspace_fts ORDER BY path').all();
  config('family-shared',['.','extra','notes/users']);expect(getWorkspaceIndexStatus().state).toBe('never_indexed');expect((await searchWorkspace({query:'alpha'})).rows).toEqual([]);
  expect(normalizeWorkspaceIndexRoots('all')).toEqual([path.join(ws.workspace,'notes/family'),path.join(ws.workspace,'.pi/skills')]);
  const ready=await refreshWorkspaceIndex();expect(ready.state).toBe('ready');expect(ready.indexed_file_count).toBe(2);expect(ready.roots).toEqual(['notes/family','.pi/skills']);
  expect((await searchWorkspace({query:'alpha'})).rows.map(row=>row.path).sort()).toEqual(['.pi/skills/shared/SKILL.md','notes/family/MEMORY.md']);
  expect((await searchWorkspace({query:'alpha',scope:'notes'})).rows.map(row=>row.path)).toEqual(['notes/family/MEMORY.md']);
  expect((await searchWorkspace({query:'alpha',scope:'skills'})).rows.map(row=>row.path)).toEqual(['.pi/skills/shared/SKILL.md']);
  expect(JSON.stringify(getDb().query('SELECT content FROM family_workspace_fts').all())).not.toContain('PERSONAL');expect(getDb().query('SELECT * FROM workspace_fts ORDER BY path').all()).toEqual(legacy);
  config('single-user');expect((await searchWorkspace({query:'PERSONAL_ALICE'})).rows).toHaveLength(1);
});

test('family ignores file/directory/root symlinks and hard links and never follows them into personal notes',async()=>{
  config('family-shared');await file('notes/users/alice/MEMORY.md','secret PERSONAL');await file('notes/family/ok.md','safe FAMILY');await file('.pi/skills/a/SKILL.md','safe SKILL');
  await fs.symlink(path.join(ws.workspace,'notes/users/alice/MEMORY.md'),path.join(ws.workspace,'notes/family/link.md'));
  await fs.symlink(path.join(ws.workspace,'notes/users'),path.join(ws.workspace,'notes/family/linked-users'));
  await fs.link(path.join(ws.workspace,'notes/users/alice/MEMORY.md'),path.join(ws.workspace,'notes/family/hard.md'));
  await refreshWorkspaceIndex();expect((await searchWorkspace({query:'secret'})).rows).toEqual([]);expect(getWorkspaceIndexStatus().indexed_file_count).toBe(2);
  await fs.rm(path.join(ws.workspace,'notes/family'),{recursive:true});await fs.symlink(path.join(ws.workspace,'notes/users'),path.join(ws.workspace,'notes/family'));
  await refreshWorkspaceIndex();expect(getWorkspaceIndexStatus().indexed_file_count).toBe(1);expect((await searchWorkspace({query:'secret'})).rows).toEqual([]);
});

test('family LIKE fallback and offset use only dedicated fixed-root rows',async()=>{
  config('family-shared');await file('notes/family/a.md','alpha one');await file('notes/family/b.md','alpha two');await refreshWorkspaceIndex();
  getDb().query('INSERT INTO workspace_fts(content,path) VALUES (?,?)').run('alpha PRIVATE','notes/users/alice/MEMORY.md');
  getDb().query('INSERT INTO family_workspace_fts(content,path) VALUES (?,?)').run('alpha INVALID_ROOT','notes/users/bob/MEMORY.md');
  const query=getDb().query.bind(getDb());const spy=spyOn(getDb(),'query').mockImplementation(((sql:string)=>{if(sql.includes(' MATCH '))throw Object.assign(Error('fts5: syntax error near token'),{code:'SQLITE_ERROR'});return query(sql);}) as any);
  try{const result=await searchWorkspace({query:'alpha',scope:'notes',limit:1,offset:1});expect(result.rows.map(row=>row.path)).toEqual(['notes/family/b.md']);expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(JSON.stringify(result)).not.toContain('INVALID_ROOT');}finally{spy.mockRestore();}
});

test('family partial refresh and stale paths never touch personal index or status, SQL failure rolls entire staged replacement back',async()=>{
  config('family-shared');await file('notes/family/a.md','alpha');await file('.pi/skills/a/SKILL.md','skill');await refreshWorkspaceIndex();const before=snapshot();
  const requested:string[]=[];setBackgroundWorkspaceIndexRefreshRequesterForTests(p=>requested.push(String(p?.scope)));
  markWorkspaceIndexStale({paths:['notes/users/alice/MEMORY.md']});expect(snapshot()).toBe(before);expect(requested).toEqual([]);
  markWorkspaceIndexStale({paths:['notes/family/a.md']});expect(requested).toEqual(['notes','all']);
  await file('notes/family/a.md','new');await refreshWorkspaceIndex({scope:'notes'});expect(getWorkspaceIndexStatus({scope:'notes'}).state).toBe('ready');expect(getWorkspaceIndexStatus().state).toBe('stale');expect((await searchWorkspace({query:'skill',scope:'skills'})).rows).toHaveLength(1);
  const committed=snapshot();getDb().exec("CREATE TRIGGER fail_family_index BEFORE INSERT ON family_workspace_files BEGIN SELECT RAISE(ABORT,'index failure'); END");
  await expect(refreshWorkspaceIndex()).rejects.toThrow('index failure');expect(snapshot()).toBe(committed);getDb().exec('DROP TRIGGER fail_family_index');await refreshWorkspaceIndex();
});

test('mode change across legacy read await rejects without stale SQL content or failed-status mutation',async()=>{
  await file('notes/users/alice/MEMORY.md','PERSONAL');const read=fs.readFile;
  const spy=spyOn(fs,'readFile').mockImplementation((async(...args:any[])=>{const content=await Reflect.apply(read,fs,args);config('family-shared');return content;}) as any);
  try{await expect(refreshWorkspaceIndex()).rejects.toBeInstanceOf(WorkspaceIndexAccessDenied);}finally{spy.mockRestore();}
  expect(getDb().query('SELECT count(*) n FROM workspace_fts').get()).toEqual({n:0});expect(getWorkspaceIndexStatus().state).toBe('never_indexed');expect((await searchWorkspace({query:'PERSONAL'})).rows).toEqual([]);
  config('single-user');await refreshWorkspaceIndex();expect(getWorkspaceIndexStatus().state).toBe('ready');
});

test('family mode change while staging preserves both stores and releases local active marker',async()=>{
  config('family-shared');await file('notes/family/a.md','old');await refreshWorkspaceIndex();const before=snapshot();await file('notes/family/a.md','changed');
  const read=fs.opendir;const spy=spyOn(fs,'opendir').mockImplementation((async(...args:any[])=>{const value=await Reflect.apply(read,fs,args);config('single-user');return value;}) as any);
  try{await expect(refreshWorkspaceIndex()).rejects.toBeInstanceOf(WorkspaceIndexAccessDenied);}finally{spy.mockRestore();}
  expect(snapshot()).toBe(before);config('family-shared');expect(getWorkspaceIndexStatus().state).toBe('ready');await refreshWorkspaceIndex();expect((await searchWorkspace({query:'changed'})).rows).toHaveLength(1);
});

test('invalid/isolated mode and model contexts deny before reading arguments, stale family ALS cannot fall back to single-user',async()=>{
  const identity:ExecutionIdentity={mode:'family-shared',username:'alice',displayName:'Alice',role:'member',rootChatJid:'web:alice',provenance:{actorUserId:'alice',ownerUserId:'alice',chatJid:'web:alice',kind:'interactive'}};
  const args=new Proxy({query:'private'},{get(){throw Error('arguments accessed');}});config('family-shared');
  await expect(withExecutionIdentity(identity,()=>searchWorkspace(args))).rejects.toBeInstanceOf(WorkspaceIndexAccessDenied);
  config('single-user');expect(()=>withExecutionIdentity(identity,()=>getWorkspaceIndexStatus())).toThrow(WorkspaceIndexAccessDenied);
  for(const mode of ['isolated-containers','invalid']){config(mode);await expect(searchWorkspace(args)).rejects.toThrow();}
});

test('worker launch pins mode and refuses a changed-mode child before initialising its database',async()=>{
  config('family-shared');let env:NodeJS.ProcessEnv={},args:string[]=[];class Child extends EventEmitter{exitCode=null;killed=false;unref(){}}
  setWorkspaceIndexSpawnForTests((_c,a,opts)=>{args=a;env=opts.env!;return new Child() as any;});expect(launchWorkspaceIndexProcess()).toBe(true);expect(args.slice(-2)).toEqual(['--expected-mode','family-shared']);expect(env.PICLAW_WORKSPACE).toBe(ws.workspace);
  const before=snapshot();for(const invalid of [[],['--expected-mode=family-shared'],['--expected-mode'],['--expected-mode','single-user'],['--expected-mode','family-shared','--expected-mode','family-shared']])await expect(runWorkspaceIndexProcessFromArgs(invalid)).rejects.toBeInstanceOf(WorkspaceIndexAccessDenied);expect(snapshot()).toBe(before);
});

test('family refresh enforces file size/depth/entry bounds atomically and closes streaming directory handles',async()=>{
  config('family-shared');await file('notes/family/keep.md','before');await file('notes/family/large.md','x'.repeat(16385));await refreshWorkspaceIndex({max_kb:16});
  expect(getWorkspaceIndexStatus().indexed_file_count).toBe(1);const before=snapshot();
  let entries=0,closed=false;const open=spyOn(fs,'opendir').mockImplementation((async()=>({read:async()=>{entries++;return {name:'ignored',isDirectory:()=>false,isFile:()=>false};},close:async()=>{closed=true;}})) as any);
  try{await expect(refreshWorkspaceIndex()).rejects.toThrow('entry limit');expect(entries).toBe(20001);expect(closed).toBe(true);expect(snapshot()).toBe(before);}finally{open.mockRestore();}
  await file('notes/family/'+Array(18).fill('deep').join('/')+'/a.md','too deep');await expect(refreshWorkspaceIndex()).rejects.toThrow('depth limit');expect(snapshot()).toBe(before);
});

test('family operational FTS errors never fall back and invalid scopes cannot widen a query',async()=>{
  config('family-shared');await file('notes/family/a.md','alpha');await refreshWorkspaceIndex();
  let queries=0;const query=getDb().query.bind(getDb());const spy=spyOn(getDb(),'query').mockImplementation(((sql:string)=>{if(sql.includes('family_workspace_fts')){queries++;throw Object.assign(Error('database disk image is malformed'),{code:'SQLITE_CORRUPT'});}return query(sql);}) as any);
  try{const result=await searchWorkspace({query:'alpha'});expect(result.rows).toEqual([]);expect(result.error).toBe('Workspace search failed.');expect(queries).toBe(1);}finally{spy.mockRestore();}
  await expect(searchWorkspace({query:'alpha',scope:'unknown'})).rejects.toBeInstanceOf(WorkspaceIndexAccessDenied);
  await expect(refreshWorkspaceIndex({scope:'unknown'})).rejects.toBeInstanceOf(WorkspaceIndexAccessDenied);
});

test('mode changes after a family file read discard staging and cannot be swallowed as unreadable data',async()=>{
  config('family-shared');await file('notes/family/a.md','alpha');await refreshWorkspaceIndex();const before=snapshot(),open=fs.open;
  const spy=spyOn(fs,'open').mockImplementation((async(...args:any[])=>{
    const handle=await Reflect.apply(open,fs,args),read=handle.read.bind(handle);
    handle.read=(async(...parts:any[])=>{const value=await Reflect.apply(read,handle,parts);config('single-user');return value;}) as any;
    return handle;
  }) as any);
  try{await expect(refreshWorkspaceIndex()).rejects.toBeInstanceOf(WorkspaceIndexAccessDenied);}finally{spy.mockRestore();}
  expect(snapshot()).toBe(before);config('family-shared');await refreshWorkspaceIndex();expect(getWorkspaceIndexStatus().state).toBe('ready');
});

test('source-change generation during staging rejects stale commit and partial refresh preserves unaffected ready scope',async()=>{
  config('family-shared');await file('notes/family/a.md','alpha');await file('.pi/skills/a/SKILL.md','skill');await refreshWorkspaceIndex();
  const prior=getDb().query('SELECT * FROM family_workspace_fts ORDER BY path').all();const open=fs.open;let notified=false;
  const spy=spyOn(fs,'open').mockImplementation((async(...args:any[])=>{
    const handle=await Reflect.apply(open,fs,args),read=handle.read.bind(handle);
    handle.read=(async(...parts:any[])=>{const value=await Reflect.apply(read,handle,parts);if(!notified){notified=true;markWorkspaceIndexStale({paths:['notes/family/a.md']});}return value;}) as any;
    return handle;
  }) as any);
  try{await expect(refreshWorkspaceIndex()).rejects.toThrow('superseded');}finally{spy.mockRestore();}
  expect(getDb().query('SELECT * FROM family_workspace_fts ORDER BY path').all()).toEqual(prior);expect(getWorkspaceIndexStatus({scope:'notes'}).state).toBe('stale');expect(getWorkspaceIndexStatus({scope:'skills'}).state).toBe('ready');
  await refreshWorkspaceIndex({scope:'notes'});expect(getWorkspaceIndexStatus({scope:'notes'}).state).toBe('ready');expect(getWorkspaceIndexStatus({scope:'skills'}).state).toBe('ready');expect(getWorkspaceIndexStatus().state).toBe('stale');
});

test('legacy initial status failure releases active scope and permits a clean subsequent refresh',async()=>{
  await file('notes/a.md','alpha');getDb().exec("CREATE TRIGGER fail_initial_status BEFORE INSERT ON workspace_index_status BEGIN SELECT RAISE(ABORT,'status failed'); END");
  await expect(refreshWorkspaceIndex({scope:'notes'})).rejects.toThrow('status failed');getDb().exec('DROP TRIGGER fail_initial_status');
  expect(getWorkspaceIndexStatus({scope:'notes'}).state).toBe('never_indexed');await refreshWorkspaceIndex({scope:'notes'});expect(getWorkspaceIndexStatus({scope:'notes'}).state).toBe('ready');
});
