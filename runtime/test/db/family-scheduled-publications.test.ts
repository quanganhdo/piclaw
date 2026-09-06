import { afterEach, beforeEach, expect, test, spyOn } from "bun:test";
import Database from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv, waitFor } from "../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { createFamilyScheduledTask, revokeFamilyScheduledGrant } from "../../src/db/family-scheduled-grants.js";
import { claimFamilyScheduledOccurrence } from "../../src/db/family-scheduled-occurrences.js";
import { beginFamilyScheduledExecution, settleFamilyScheduledExecution, listOwnFamilyScheduledResults } from "../../src/db/family-scheduled-executions.js";
import { publishOwnFamilyScheduledResult as publish } from "../../src/db/family-scheduled-publications.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { createOwnedRoot, archiveOwnedSession } from "../../src/db/owned-session-lifecycle.js";
import { getUser } from "../../src/db/users.js";
import { getMessagesSince, storeMessageInDatabase } from "../../src/db/messages.js";
import { RequestRouterService } from "../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../src/channels/web/auth/auth-gateway.js";
import { WebauthnChallengeTracker } from "../../src/channels/web/auth/webauthn-challenges.js";
import { TotpFailureTracker } from "../../src/channels/web/auth/totp-failure-tracker.js";
import { resetRateLimiterStateForTests } from "../../src/channels/web/http/rate-limit.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void, admin: AuthenticatedPrincipal, alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal;
function actor(id: string): AuthenticatedPrincipal {
  const user=getUser(getDb(),id)!, login=createWebSession(`token-${id}`,id,3600,"passkey");
  return { kind:"user",mode:"family-shared",userId:id,username:user.username,displayName:user.display_name,role:user.role,
    homeChatJid:user.home_chat_jid,authentication:{method:"passkey",sessionId:login.session_id!,expiresAt:login.expires_at} };
}
beforeEach(()=>{
  ws=createTempWorkspace("family-publication-");restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  mkdirSync(join(ws.workspace,".piclaw"));writeFileSync(join(ws.workspace,".piclaw/config.json"),JSON.stringify({domains:{access:{mode:"family-shared"}}}));
  closeDatabase();initDatabase();resetRateLimiterStateForTests();admin=actor("default");
  [alice,bob]=["alice","bob"].map(name=>{const user=provisionFamilyAccount(getDb(),admin,{username:name,displayName:name});
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id,name);
    updateManagedAccount(getDb(),admin,user.id,{enabled:true},{totp:false,passkey:true,rpId:"family.local"});return actor(user.id);
  });
});
afterEach(()=>{closeDatabase();resetRateLimiterStateForTests();restore();ws.cleanup();});
function settled(text="private output\n/looks-like-a-command",chat=alice.homeChatJid!,status:"success"|"error"="success",finish=true) {
  const db=getDb(),realNow=Date.now,clock=Date.now()+10;
  try {
    Date.now=()=>clock-10;
    const ids=createFamilyScheduledTask(db,alice,chat,{prompt:"test prompt",scheduled_for:new Date(clock).toISOString(),allowed_tools:[]});
    Date.now=()=>clock;const lease=claimFamilyScheduledOccurrence(db,ids.grant_id,"worker"),cap=beginFamilyScheduledExecution(db,lease);
    if(finish)settleFamilyScheduledExecution(db,cap,{status,text});
    // Publication uses current wall time; make the fixture clock current without a future result.
    return {...ids,...cap,at:clock};
  } finally {Date.now=realNow;}
}
async function ready(...args: Parameters<typeof settled>) {const result=settled(...args);await Bun.sleep(15);return result;}
function snapshot(db=getDb()) {return JSON.stringify(["messages","message_media","chat_cursors","family_scheduled_publications"].map(t=>db.query(`SELECT * FROM ${t} ORDER BY rowid`).all()));}
function router() {
  const json=(value:unknown,status=200)=>Response.json(value,{status});
  const authGateway=new WebAuthGateway({accessMode:"family-shared",passkeyMode:"",totpSecret:"",internalSecret:"",hasTls:true,sessionTtlSeconds:3600},{json,challenges:new WebauthnChallengeTracker(),failureTracker:new TotpFailureTracker()});
  return new RequestRouterService({json,authGateway,clampInt:(v:string|null,f:number)=>v===null?f:Number(v),parseOptionalInt:(v:string|null)=>v===null?null:Number(v)} as any,"family-shared");
}
function request(path:string,who=alice,method="GET",body?:BodyInit,headers:Record<string,string>={},signal?:AbortSignal) {
  return new Request("https://family.local"+path,{method,headers:{cookie:`piclaw_session=token-${who.userId}`,origin:"https://family.local","x-piclaw-account-id":who.userId,"x-piclaw-login-id":who.authentication.sessionId!,...headers},body,signal});
}

test("publication is one service-labelled bot message, atomic receipt, immutable attribution and no input/cursor effects",async()=>{
  const db=getDb(),source=await ready(),beforeCursors=db.query("SELECT * FROM chat_cursors").all();
  const first=publish(db,alice,source.execution_id),before=snapshot();
  expect(first.created).toBe(true);expect(first.chat_jid).toBe(alice.homeChatJid!);expect(publish(db,alice,source.execution_id)).toEqual({...first,created:false});expect(snapshot()).toBe(before);
  const msg=db.query("SELECT * FROM messages WHERE rowid=?").get(first.message_rowid) as any;
  expect(msg).toMatchObject({sender:"service:scheduler",sender_name:"Scheduled task",is_bot_message:1,is_terminal_agent_reply:0,is_from_me:1,is_steering_message:0,thread_id:null,content_blocks:null,link_previews:null});
  expect(msg.content).toContain('Owner: "alice" ("alice")');expect(msg.content).toContain("private output");expect(JSON.stringify(msg)).not.toContain(source.token);
  const approvingLogin=alice.authentication.sessionId;alice=actor(alice.userId);
  expect(publish(db,alice,source.execution_id)).toEqual({...first,created:false});
  expect(db.query("SELECT login_session_id FROM family_scheduled_publications WHERE execution_id=?").get(source.execution_id)).toEqual({login_session_id:approvingLogin});
  expect(getMessagesSince(alice.homeChatJid!,"1970-01-01T00:00:00.000Z","Smith")).toEqual([]);expect(db.query("SELECT * FROM chat_cursors").all()).toEqual(beforeCursors);
  expect(()=>db.exec("DELETE FROM family_scheduled_publications")).toThrow("cannot be deleted");
});

test("live owner confirmation rejects foreign admins, revoked/stale login, missing results and archived targets",async()=>{
  const db=getDb(),source=await ready();for(const who of [bob,admin])expect(()=>publish(db,who,source.execution_id)).toThrow();
  db.query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now()-600000).toISOString(),alice.authentication.sessionId!);
  expect(()=>publish(db,alice,source.execution_id)).toThrow();alice=actor(alice.userId);
  const pending=await ready("",alice.homeChatJid!,"success",false);expect(()=>publish(db,alice,pending.execution_id)).toThrow();
  const root=createOwnedRoot(db,alice,"publication-archive"),archived=await ready("history",root.chat_jid);archiveOwnedSession(db,alice,root.chat_jid);expect(()=>publish(db,alice,archived.execution_id)).toThrow();
  db.query("DELETE FROM web_sessions WHERE user_id=?").run(alice.userId);expect(()=>publish(db,alice,source.execution_id)).toThrow();expect(db.query("SELECT count(*) n FROM family_scheduled_publications").get()).toEqual({n:0});
});

test("historic result can publish after grant revocation and profile rename without relabelling its author",async()=>{
  const db=getDb(),source=await ready("",alice.homeChatJid!,"error");revokeFamilyScheduledGrant(db,alice,source.grant_id);
  db.query("UPDATE users SET username='new-name',display_name='New name' WHERE id=?").run(alice.userId);alice=actor(alice.userId);
  const value=publish(db,alice,source.execution_id),msg=db.query("SELECT content FROM messages WHERE rowid=?").get(value.message_rowid) as any;
  expect(msg.content).toContain("Scheduled task result (error)");expect(msg.content).toContain('Owner: "alice" ("alice")');expect(msg.content).not.toContain("New name");
});

test("receipt failure rolls back message and FTS, deterministic ID collision never overwrites a row",async()=>{
  const db=getDb(),source=await ready(),before=snapshot();
  db.exec("CREATE TRIGGER fail_publication BEFORE INSERT ON family_scheduled_publications BEGIN SELECT RAISE(ABORT,'receipt failure'); END");
  expect(()=>publish(db,alice,source.execution_id)).toThrow("receipt failure");expect(snapshot()).toBe(before);expect(db.query("SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'private'").get()).toEqual({n:0});db.exec("DROP TRIGGER fail_publication");
  storeMessageInDatabase(db,{id:`scheduled-result-${source.execution_id}`,chat_jid:bob.homeChatJid!,sender:"old",sender_name:"old",content:"retain",timestamp:new Date().toISOString()});
  const collision=snapshot();expect(()=>publish(db,alice,source.execution_id)).toThrow();expect(snapshot()).toBe(collision);
});

test("missing or changed published messages cannot be recreated or acknowledged as an exact retry",async()=>{
  const db=getDb();
  for(const column of ["content","sender","sender_name","is_bot_message","is_terminal_agent_reply","thread_id","content_blocks","annotations"]) {
    const source=await ready(),published=publish(db,alice,source.execution_id);
    const value=column.startsWith("is_")?9:column==="thread_id"?published.message_rowid:column==="content_blocks"||column==="annotations"?'[]':"changed";
    db.query(`UPDATE messages SET ${column}=? WHERE rowid=?`).run(value,published.message_rowid);
    expect(()=>publish(db,alice,source.execution_id)).toThrow();
  }
  const source=await ready(),published=publish(db,alice,source.execution_id);db.query("DELETE FROM messages WHERE rowid=?").run(published.message_rowid);
  expect(()=>publish(db,alice,source.execution_id)).toThrow();
  const attached=await ready(),message=publish(db,alice,attached.execution_id);
  expect(()=>publish(db,alice,source.execution_id)).toThrow(); // reused rowid never revives old receipt
  db.query("INSERT INTO media(id,filename,content_type,data) VALUES (999999,'test','text/plain',?)").run(new Uint8Array([1]));
  db.query("INSERT INTO message_media(message_rowid,media_id) VALUES (?,999999)").run(message.message_rowid);
  expect(()=>publish(db,alice,attached.execution_id)).toThrow();
});

test("two connections and reopened stores acknowledge one publication without touching the global database",async()=>{
  const source=await ready(),path=join(ws.workspace,"publication.sqlite");getDb().query("VACUUM INTO ?").run(path);const a=new Database(path),b=new Database(path);
  try{const first=publish(a,alice,source.execution_id);expect(publish(b,alice,source.execution_id)).toEqual({...first,created:false});expect(getDb().query("SELECT count(*) n FROM messages").get()).toEqual({n:0});}finally{a.close();b.close();}
  const reopened=new Database(path);try{expect(publish(reopened,alice,source.execution_id).created).toBe(false);}finally{reopened.close();}
});

test("HTTP read/publication require pins, Origin and explicit confirmation; returns timeline-visible original target once",async()=>{
  const source=await ready(),r=router(),path=`/agent/scheduled-results/${source.execution_id}`;
  const own=await r.handle(request(path));expect(own.status).toBe(200);expect(own.headers.get("cache-control")).toBe("private, no-store");expect(JSON.stringify(await own.json())).not.toContain(source.token);
  expect((await r.handle(request(path,bob))).status).toBe(403);expect((await r.handle(request(path,admin))).status).toBe(403);
  expect((await r.handle(request(path+"?chat_jid="+bob.homeChatJid))).status).toBe(403);
  expect((await r.handle(request(path,alice,"GET",undefined,{"x-piclaw-account-id":"","x-piclaw-login-id":""}))).status).toBe(409);
  const unpinned=request(path);unpinned.headers.delete("x-piclaw-account-id");unpinned.headers.delete("x-piclaw-login-id");expect((await r.handle(unpinned)).status).toBe(403);
  for(const body of [{confirm:false},{confirm:true,chat_jid:bob.homeChatJid},{confirm:true,text:"injected"},{}])expect((await r.handle(request(path+"/publish",alice,"POST",JSON.stringify(body)))).status).toBe(403);
  expect((await r.handle(request(path+"/publish",alice,"POST",'{"confirm":true}',{origin:"https://foreign.local"}))).status).toBe(403);
  const first=await r.handle(request(path+"/publish",alice,"POST",'{"confirm":true}'));expect(first.status).toBe(201);const value=await first.json();
  expect((await r.handle(request(path+"/publish",alice,"POST",'{"confirm":true}'))).status).toBe(200);
  const timeline=await r.handle(request('/timeline?chat_jid='+encodeURIComponent(alice.homeChatJid!)));expect(timeline.status).toBe(200);expect(JSON.stringify(await timeline.json())).toContain("private output");
  expect(value.chat_jid).toBe(alice.homeChatJid!);expect(getDb().query("SELECT count(*) n FROM messages").get()).toEqual({n:1});
});

test("HTTP rejects overlong/aborted body and login revocation during confirmation without late publication",async()=>{
  const source=await ready(),r=router(),path=`/agent/scheduled-results/${source.execution_id}/publish`;
  expect((await r.handle(request(path,alice,"POST"," ".repeat(1025)))).status).toBe(403);
  const controller=new AbortController();controller.abort();expect((await r.handle(request(path,alice,"POST",'{"confirm":true}',{},controller.signal))).status).toBe(403);
  const body=new ReadableStream({start(c){getDb().query("DELETE FROM web_sessions WHERE session_id=?").run(alice.authentication.sessionId!);c.enqueue(new TextEncoder().encode('{"confirm":true}'));c.close();}});
  expect((await r.handle(request(path,alice,"POST",body as any))).status).toBe(401);
  alice=actor(alice.userId);let stream!:ReadableStreamDefaultController;
  const delayed=new ReadableStream({start(c){stream=c;}});const pending=r.handle(request(path,alice,"POST",delayed as any));
  await Bun.sleep(5);getDb().query("DELETE FROM web_sessions WHERE session_id=?").run(alice.authentication.sessionId!);stream.enqueue(new TextEncoder().encode('{"confirm":true}'));stream.close();
  expect((await pending).status).toBe(403);expect(getDb().query("SELECT count(*) n FROM messages").get()).toEqual({n:0});
});

test("publication limit is per account and GET does not consume the mutation allowance",async()=>{
  const source=await ready(),r=router(),path=`/agent/scheduled-results/${source.execution_id}`;
  for(let i=0;i<20;i++){expect((await r.handle(request(path))).status).toBe(200);expect([200,201]).toContain((await r.handle(request(path+"/publish",alice,"POST",'{"confirm":true}'))).status);}
  expect((await r.handle(request(path+"/publish",alice,"POST",'{"confirm":true}'))).status).toBe(429);
});

test("stalled confirmation times out, cancels its reader and cannot publish later",async()=>{
  const source=await ready(),r=router(),path=`/agent/scheduled-results/${source.execution_id}/publish`;
  const original=globalThis.setTimeout;let expire:(()=>void)|undefined;let cancelled=false;
  const timer=spyOn(globalThis,"setTimeout").mockImplementation(((fn:any,ms:number,...args:any[])=>{
    if(ms===10000){expire=fn;return {unref(){}} as any;}return original(fn,ms,...args);
  }) as any);
  try{
    const stream=new ReadableStream({cancel(){cancelled=true;}});
    const pending=r.handle(request(path,alice,"POST",stream as any));await waitFor(()=>!!expire);expire!();
    expect((await pending).status).toBe(403);expect(cancelled).toBe(true);expect(getDb().query("SELECT count(*) n FROM messages").get()).toEqual({n:0});
  }finally{timer.mockRestore();}
});

test("HTTP persistence failures return retryable server error without a partial message",async()=>{
  const source=await ready(),db=getDb(),r=router(),path=`/agent/scheduled-results/${source.execution_id}/publish`;
  expect((await r.handle(request(path,alice,"POST","not-json"))).status).toBe(403);
  db.exec("CREATE TRIGGER fail_http_publication BEFORE INSERT ON family_scheduled_publications BEGIN SELECT RAISE(ABORT,'fixture storage failed'); END");
  const response=await r.handle(request(path,alice,"POST",'{"confirm":true}'));expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain("fixture storage");
  expect(db.query("SELECT count(*) n FROM messages").get()).toEqual({n:0});db.exec("DROP TRIGGER fail_http_publication");
  expect((await r.handle(request(path,alice,"POST",'{"confirm":true}'))).status).toBe(201);
});

test("result directory filters by owner and active original target before returning metadata only",async()=>{
  const db=getDb(),owned=await ready(),pending=await ready('',alice.homeChatJid!,'success',false);
  const root=createOwnedRoot(db,alice,'hidden-result'),archived=await ready('archive secret',root.chat_jid);archiveOwnedSession(db,alice,root.chat_jid);
  const savedAlice=alice;alice=bob;const foreign=await ready('foreign secret');alice=savedAlice;
  publish(db,alice,owned.execution_id);
  const directory=listOwnFamilyScheduledResults(db,alice),text=JSON.stringify(directory);
  expect(directory).toMatchObject({owner_user_id:alice.userId,window_size:50});expect(directory.items).toHaveLength(2);
  expect(directory.items.find(row=>row.execution_id===owned.execution_id)).toMatchObject({state:'settled',publication_recorded:true});
  expect(directory.items.find(row=>row.execution_id===pending.execution_id)?.state).toBe('unsettled');
  for(const excluded of [archived.execution_id,foreign.execution_id,'private output','archive secret','foreign secret','settlement_token_hash','prompt'])expect(text).not.toContain(excluded);
  expect(listOwnFamilyScheduledResults(db,admin).items).toEqual([]);
  db.query('DELETE FROM web_sessions WHERE session_id=?').run(alice.authentication.sessionId!);expect(()=>listOwnFamilyScheduledResults(db,alice)).toThrow();
});

test("result directory has a bounded deterministic newest-owner window and does not parse result bodies",async()=>{
  const db=getDb(),ids:string[]=[];
  for(let i=0;i<51;i++)ids.push((await ready(`result-${i}`)).execution_id);
  const list=listOwnFamilyScheduledResults(db,alice);expect(list.items).toHaveLength(50);expect(list.items.some(row=>row.execution_id===ids[0])).toBe(false);
  expect(list.items[0].execution_id).toBe(ids.at(-1)!);
  db.exec('DROP TRIGGER family_scheduled_result_immutable');db.query("UPDATE family_scheduled_results SET text='corrupt body' WHERE execution_id=?").run(ids.at(-1)!);
  expect(listOwnFamilyScheduledResults(db,alice).items).toEqual(list.items);
  const r=router();expect((await r.handle(request(`/agent/scheduled-results/${ids.at(-1)}`))).status).toBe(403);
});

test("directory HTTP is pinned GET-only with no caller-selected scope or pagination",async()=>{
  await ready();const r=router(),path='/agent/scheduled-results';
  const response=await r.handle(request(path));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect((await response.json()).items).toHaveLength(1);
  for(const suffix of ['?owner=bob','?chat_jid=web:bob','?limit=100','?before=1'])expect((await r.handle(request(path+suffix))).status).toBe(403);
  expect((await r.handle(request(path,alice,'POST','{}'))).status).toBe(403);
  const unpinned=request(path);unpinned.headers.delete('x-piclaw-account-id');unpinned.headers.delete('x-piclaw-login-id');expect((await r.handle(unpinned)).status).toBe(403);
});
