import {beforeEach,afterEach,expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {SettingsManager} from '@earendil-works/pi-coding-agent';
import {getModel} from '@earendil-works/pi-ai/compat';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {createTestModelRuntime} from '../model-services-fixture.js';
import {getDb,initDatabase,closeDatabase} from '../../src/db/connection.js';
import {createWebSession,revokeUserWebSessions} from '../../src/db/web-sessions.js';
import {provisionUserHome} from '../../src/db/session-ownership.js';
import {migrateOwnedSessionHandles} from '../../src/db/session-handles.js';
import {readOwnedForkSeed} from '../../src/db/owned-forks.js';
import {authoriseExecutionIdentity} from '../../src/agent-pool/execution-identity.js';
import {withExecutionIdentity} from '../../src/core/execution-context.js';
import {withChatContext} from '../../src/core/chat-context.js';
import {requireOwnedSessionExecution} from '../../src/agent-pool/owned-session-access.js';
import {createSessionInDir} from '../../src/agent-pool/session.js';
import {AgentSessionManager} from '../../src/agent-pool/session-manager.js';
import {inspectAdoptedSession} from '../../src/agent-pool/adopted-session.js';
import {adoptedJsonl} from './adopted-session-fixture.js';

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,login:string;
const child='web:default:child';const managers:AgentSessionManager[]=[];
beforeEach(()=>{
  ws=createTempWorkspace('piclaw-adopted-runtime-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});mkdirSync(join(ws.workspace,'.piclaw'));writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));
  closeDatabase();initDatabase();const db=getDb();
  for(const [jid,parent,name] of [['web:default',null,'main'],[child,'root','child']] as const){db.query("INSERT INTO chats(jid,name,last_message_time) VALUES (?,?,'now')").run(jid,name);db.query("INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at) VALUES (?,?,'web:default',?,?,'now','now')").run(parent?'child':'root',jid,parent,name);}
  provisionUserHome(db,'default','web:default');migrateOwnedSessionHandles(db);login=createWebSession('login','default',3600,'passkey').session_id!;
});
afterEach(async()=>{for(const manager of managers.splice(0))await manager.shutdown();closeDatabase();restore();ws.cleanup();});
function identity(){return authoriseExecutionIdentity(getDb(),'family-shared',child,{actorUserId:'default',ownerUserId:'default',chatJid:child,kind:'interactive',authenticationSessionId:login})!;}
function run<T>(fn:()=>Promise<T>){return withExecutionIdentity(identity(),()=>withChatContext(child,'web',fn));}
function seed(){const fixture=adoptedJsonl(ws.workspace,join(ws.data,'parent.jsonl'));getDb().query("INSERT INTO owned_fork_operations VALUES ('default','adopted','root','child',?,'now',NULL)").run(JSON.stringify({version:1,mode:'adopted_jsonl',sha256:fixture.sha256,jsonl:fixture.jsonl}));return fixture;}

test('strict parser preserves complete v3 tree and rejects bad hashes, unknown/orphan IDs and unfinished turns',()=>{
  const fixture=adoptedJsonl(ws.workspace,'/parent.jsonl');expect(inspectAdoptedSession(fixture.jsonl,fixture.sha256).entryCount).toBe(7);
  expect(()=>inspectAdoptedSession(fixture.jsonl,'0'.repeat(64))).toThrow();
  for(const change of [(r:any[])=>r[0].version=2,(r:any[])=>r[4].id='user',(r:any[])=>r[4].parentId='missing',(r:any[])=>r[4].message.stopReason='toolUse',(r:any[])=>r[5].type='unknown',(r:any[])=>r[6].targetId='missing']){
    const rows=structuredClone(fixture.rows);change(rows);const text=rows.map(r=>JSON.stringify(r)).join('\n');expect(()=>inspectAdoptedSession(text,createHash('sha256').update(text).digest('hex'))).toThrow();
  }
});

test('real SDK first-use import retains original IDs/custom/labels/model/thinking and latest friendly name, with no second replay',async()=>{
  const fixture=seed(),base=getModel('anthropic','claude-sonnet-4-5')!;
  const modelRuntime=createTestModelRuntime([{...base,provider:'test',id:'fixture'}]),settings=SettingsManager.inMemory({compaction:{enabled:false}});
  let imports=0;
  const makeManager=()=>new AgentSessionManager({pool:new Map(),sidePool:new Map(),modelRuntime,settingsManager:settings,createDefaultTools:()=>[],
    createSession:async jid=>{const runtime=await createSessionInDir(join(ws.data,'runtime-sessions'),{chatJid:jid,tools:[],modelRuntime,settingsManager:settings});const original=runtime.importFromJsonl.bind(runtime);runtime.importFromJsonl=async(...args)=>{imports++;return original(...args);};return runtime;},bindSession:async()=>{},ensureBranchRegistration:()=>{}});
  const manager=makeManager();managers.push(manager);
  mkdirSync(join(ws.data,'runtime-sessions'));const untrusted=join(ws.data,'runtime-sessions','legacy.jsonl');writeFileSync(untrusted,'malformed legacy file that must not be loaded');utimesSync(untrusted,new Date(0),new Date(0));
  getDb().query("UPDATE chat_branches SET agent_name='renamed' WHERE branch_id='child'").run();
  const runtime=await run(()=>manager.getOrCreate(child));
  expect(runtime.session.model?.id).toBe('fixture');expect(runtime.session.thinkingLevel).toBe('high');expect(runtime.session.sessionManager.getSessionName()).toBe('renamed');
  for(const row of fixture.rows.slice(1))expect(runtime.session.sessionManager.getEntry(row.id)).toEqual(row);
  expect(runtime.session.messages.some((m:any)=>JSON.stringify(m).includes('ADOPTED_PRIVATE'))).toBe(true);
  expect(readFileSync(runtime.session.sessionFile!,'utf8')).toContain('retained label');
  expect(await run(async()=>readOwnedForkSeed(getDb(),requireOwnedSessionExecution(child)!,child))).toBeNull();
  await run(()=>manager.getOrCreate(child));expect(imports).toBe(1);expect(readdirSync(join(ws.data,'runtime-sessions')).some(name=>name.startsWith('.adoption-'))).toBe(false);
  expect(readFileSync(untrusted,'utf8')).toBe('malformed legacy file that must not be loaded');
  await manager.shutdown();managers.pop();const cold=makeManager();managers.push(cold);const reopened=await run(()=>cold.getOrCreate(child));expect(imports).toBe(1);expect(reopened.session.sessionManager.getEntry('label')).toEqual(fixture.rows[6]);expect(reopened.session.messages.some((m:any)=>JSON.stringify(m).includes('ADOPTED_PRIVATE'))).toBe(true);
},20000);

test('revocation during import leaves captured seed intact, disposes failed runtime and removes temporary import files',async()=>{
  seed();const dir=join(ws.data,'failed');mkdirSync(dir);let disposed=0;
  const runtime:any={session:{sessionManager:{getSessionDir:()=>dir}},importFromJsonl:async()=>{revokeUserWebSessions('default');return {cancelled:false};},dispose:async()=>{disposed++;}};
  const manager=new AgentSessionManager({pool:new Map(),sidePool:new Map(),modelRuntime:{} as any,settingsManager:{} as any,createDefaultTools:()=>[],createSession:async()=>runtime,bindSession:async()=>{},ensureBranchRegistration:()=>{}});managers.push(manager);
  await expect(run(()=>manager.getOrCreate(child))).rejects.toThrow();expect(disposed).toBe(1);expect((getDb().query("SELECT seed_json FROM owned_fork_operations WHERE request_id='adopted'").get() as any).seed_json).toContain('adopted_jsonl');expect(readdirSync(dir)).toEqual([]);
});
