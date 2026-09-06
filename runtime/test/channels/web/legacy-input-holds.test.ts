import {beforeEach,afterEach,expect,test} from 'bun:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createTempWorkspace,setEnv} from '../../helpers.js';
import {getDb,initDatabase,closeDatabase} from '../../../src/db/connection.js';
import {getUser} from '../../../src/db/users.js';
import {createWebSession,revokeUserWebSessions} from '../../../src/db/web-sessions.js';
import {provisionFamilyAccount,updateManagedAccount} from '../../../src/db/account-administration.js';
import {getMessagesSince} from '../../../src/db/messages.js';
import {getChatCursor} from '../../../src/db/chat-cursors.js';
import {captureMigrationInputHolds,MIGRATION_INPUT_POLICY} from '../../../src/db/migration-input-holds.js';
import {resolveRequestPrincipal} from '../../../src/channels/web/auth/principal.js';
import {dismissLegacyInput,readFamilyRecoveryStatus,recoverFamilyMessage} from '../../../src/channels/web/messaging/family-message-recovery.js';
import {resolveFamilyMessageAuthority,admitFamilyMessage} from '../../../src/channels/web/messaging/family-message-authority.js';
import {WebChannel} from '../../../src/channels/web.js';
import {RequestRouterService} from '../../../src/channels/web/request-router-service.js';
import {WebAuthGateway} from '../../../src/channels/web/auth/auth-gateway.js';
import {WebauthnChallengeTracker} from '../../../src/channels/web/auth/webauthn-challenges.js';
import {TotpFailureTracker} from '../../../src/channels/web/auth/totp-failure-tracker.js';
import {resetRateLimiterStateForTests} from '../../../src/channels/web/http/rate-limit.js';
import {getIdentityConfig} from '../../../src/core/config.js';

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,alice:ReturnType<typeof actor>,bob:ReturnType<typeof actor>;
function actor(id:string){const login=createWebSession('token-'+id,id,3600,'passkey');return resolveRequestPrincipal(new Request('https://family.local',{headers:{cookie:'piclaw_session=fixture'}}),{mode:'family-shared',authEnabled:true},{getSession:()=>login,getUser:()=>getUser(getDb(),id),getLocalDisplayName:()=>''})!;}
beforeEach(()=>{ws=createTempWorkspace('piclaw-legacy-holds-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});mkdirSync(join(ws.workspace,'.piclaw'));writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));closeDatabase();initDatabase();resetRateLimiterStateForTests();const admin=actor('default');
  [alice,bob]=['alice','bob'].map(name=>{const user=provisionFamilyAccount(getDb(),admin,{username:name,displayName:name});getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id,name);updateManagedAccount(getDb(),admin,user.id,{enabled:true},{totp:false,passkey:true,rpId:'family.local'});return actor(user.id);}) as [typeof alice,typeof bob];
});
afterEach(()=>{closeDatabase();resetRateLimiterStateForTests();restore();ws.cleanup();});
function legacy(id:string,owner=alice){const row=getDb().query("INSERT INTO messages(id,chat_jid,sender,content,timestamp,is_bot_message) VALUES (?,?,'legacy-author',?,'2026-09-06T00:00:00.000Z',0)").run(id,owner.homeChatJid!,'PRIVATE_LEGACY '+id);return Number(row.lastInsertRowid);}
const request=(row:number,key='dismiss')=>({chatJid:alice.homeChatJid!,messageRowId:row,requestId:key});

test('migration hold does not invent authority; owner dismissal preserves authorship and handles same-timestamp inputs individually',()=>{
  const db=getDb(),first=legacy('first'),second=legacy('second'),foreign=legacy('foreign',bob);const before=db.query('SELECT * FROM messages ORDER BY rowid').all();
  expect(captureMigrationInputHolds(db,'a'.repeat(64),MIGRATION_INPUT_POLICY)).toBe(3);expect(db.query('SELECT * FROM message_execution_authorities').all()).toEqual([]);
  expect(readFamilyRecoveryStatus(alice)).toEqual({state:'legacy-held',message_rowid:first});expect(readFamilyRecoveryStatus(bob)).toEqual({state:'legacy-held',message_rowid:foreign});
  expect(()=>resolveFamilyMessageAuthority(alice.homeChatJid!,'first')).toThrow();expect(()=>recoverFamilyMessage(alice,{...request(first),action:'retry'})).toThrow();expect(()=>recoverFamilyMessage(alice,{...request(first),action:'skip'})).toThrow();
  expect(()=>dismissLegacyInput(bob,request(first))).toThrow();expect(()=>dismissLegacyInput(alice,request(second))).toThrow();
  expect(dismissLegacyInput(alice,request(first)).created).toBe(true);expect(dismissLegacyInput(alice,request(first)).created).toBe(false);expect(getChatCursor(alice.homeChatJid!)).toBe('');
  expect(getMessagesSince(alice.homeChatJid!,'',getIdentityConfig().assistantName).map(row=>row.id)).toEqual(['second']);expect(readFamilyRecoveryStatus(alice)).toEqual({state:'legacy-held',message_rowid:second});
  expect(()=>dismissLegacyInput(alice,request(second))).toThrow();dismissLegacyInput(alice,request(second,'second-dismiss'));expect(readFamilyRecoveryStatus(alice)).toEqual({state:'idle'});expect(db.query('SELECT * FROM messages ORDER BY rowid').all()).toEqual(before);
  expect(JSON.stringify(db.query('SELECT * FROM migration_input_dismissals').all())).not.toContain('token-');
  writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));
  expect(getMessagesSince(alice.homeChatJid!,'',getIdentityConfig().assistantName).map(row=>row.id)).toEqual(['first','second']); // Legacy mode ignores family dismissal filtering.
});

test('stale/tampered/active dismissal fails and SQL failure rolls back without changing the cursor',()=>{
  const db=getDb(),first=legacy('first');captureMigrationInputHolds(db,'snapshot',MIGRATION_INPUT_POLICY);
  db.exec("CREATE TRIGGER fail_dismiss BEFORE INSERT ON migration_input_dismissals BEGIN SELECT RAISE(ABORT,'audit failure'); END");expect(()=>dismissLegacyInput(alice,request(first))).toThrow('audit failure');expect(getChatCursor(alice.homeChatJid!)).toBe('');db.exec('DROP TRIGGER fail_dismiss');
  db.query('INSERT INTO chat_cursors(chat_jid,inflight_message_id) VALUES (?,?)').run(alice.homeChatJid!,'first');expect(()=>dismissLegacyInput(alice,request(first))).toThrow('idle');db.exec('DELETE FROM chat_cursors');
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600000).toISOString(),alice.authentication.sessionId!);expect(()=>dismissLegacyInput(alice,request(first))).toThrow();alice=actor(alice.userId);
  db.query("UPDATE messages SET content='tampered' WHERE rowid=?").run(first);expect(()=>dismissLegacyInput(alice,request(first))).toThrow();revokeUserWebSessions(alice.userId);expect(()=>readFamilyRecoveryStatus(alice)).toThrow();
});

test('real processChat never runs held/dismissed history, and a newly submitted prompt has fresh admission',async()=>{
  const first=legacy('first');captureMigrationInputHolds(getDb(),'snapshot',MIGRATION_INPUT_POLICY);let calls=0;
  const web=new WebChannel({queue:{enqueue:()=>{}},agentPool:{setSessionBinder:()=>{},getContextUsageForChat:async()=>null,runAgent:async(prompt:string)=>{calls++;expect(prompt).toContain('new reviewed prompt');return {status:'success',result:'reply',attachments:[]};}}} as any);
  try{await expect(web.processChat(alice.homeChatJid!,'default')).rejects.toThrow();expect(calls).toBe(0);dismissLegacyInput(alice,request(first));await web.processChat(alice.homeChatJid!,'default');expect(calls).toBe(0);
    admitFamilyMessage(alice,{content:'new reviewed prompt',requestId:'new-admission'});await web.processChat(alice.homeChatJid!,'default');expect(calls).toBe(1);expect(getDb().query('SELECT * FROM message_execution_authorities').all()).toHaveLength(1);
  }finally{web.sse.closeAll();}
});

test('HTTP legacy dismissal is Origin/account pinned, lane-serialized and abortable before commit',async()=>{
  const first=legacy('first');captureMigrationInputHolds(getDb(),'snapshot',MIGRATION_INPUT_POLICY);const queue:Array<()=>Promise<void>>=[];const lanes:string[]=[];
  const json=(body:unknown,status=200)=>Response.json(body,{status});const authGateway=new WebAuthGateway({accessMode:'family-shared',passkeyMode:'',totpSecret:'',internalSecret:'',hasTls:true,sessionTtlSeconds:3600},{json,challenges:new WebauthnChallengeTracker(),failureTracker:new TotpFailureTracker()});
  const router=new RequestRouterService({json,authGateway,queue:{enqueue:(fn:()=>Promise<void>,_id:string,lane:string)=>{queue.push(fn);lanes.push(lane);}},resumeChat:()=>{}} as any,'family-shared');
  const req=(origin='https://family.local',signal?:AbortSignal,pin=alice.userId)=>new Request('https://family.local/agent/message-recovery',{method:'POST',signal,headers:{origin,cookie:'piclaw_session=token-'+alice.userId,'x-piclaw-account-id':pin,'x-piclaw-login-id':alice.authentication.sessionId!},body:JSON.stringify({chat_jid:alice.homeChatJid,message_rowid:first,request_id:'http',action:'dismiss-legacy'})});
  expect((await router.handle(req(''))).status).toBe(403);expect((await router.handle(req('https://family.local',undefined,bob.userId))).status).toBe(409);
  const abort=new AbortController(),pending=router.handle(req('https://family.local',abort.signal));await Bun.sleep(1);abort.abort();expect((await pending).status).toBe(400);await queue.shift()!();expect(getDb().query('SELECT * FROM migration_input_dismissals').all()).toEqual([]);
  const successful=router.handle(req());await Bun.sleep(1);await queue.shift()!();const response=await successful;expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect((await response.json()).action).toBe('dismiss-legacy');expect(lanes.every(l=>l==='chat:'+alice.homeChatJid)).toBe(true);
});
