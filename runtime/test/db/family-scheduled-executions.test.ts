import { afterEach, beforeEach, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { createFamilyScheduledTask, revokeFamilyScheduledGrant } from "../../src/db/family-scheduled-grants.js";
import { claimFamilyScheduledOccurrence as claim, consumeFamilyScheduledOccurrence as consume } from "../../src/db/family-scheduled-occurrences.js";
import { beginFamilyScheduledExecution as begin, settleFamilyScheduledExecution as settle, readOwnFamilyScheduledResult as read } from "../../src/db/family-scheduled-executions.js";
import { initializeFamilyScheduledExecutions } from "../../src/db/family-scheduled-executions-schema.js";
import { initializeFamilyScheduledExpiry } from "../../src/db/family-scheduled-expiry-schema.js";
import { initializeFamilyScheduledInterruptions } from "../../src/db/family-scheduled-interruptions-schema.js";
import { cancelOwnFamilyScheduledExecution as cancel } from "../../src/db/family-scheduled-executions.js";
import { recoverExpiredFamilyScheduledExecutions as recover, startFamilyScheduledDispatch as start, readFamilyScheduledDispatch, listOwnFamilyScheduledResults } from "../../src/db/family-scheduled-executions.js";
import { publishOwnFamilyScheduledResult } from "../../src/db/family-scheduled-publications.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { getUser } from "../../src/db/users.js";
import { updateAdminToolPolicy } from "../../src/db/family-tool-restrictions.js";
import { createOwnedRoot, archiveOwnedSession } from "../../src/db/owned-session-lifecycle.js";
import { getTaskById, updateTask } from "../../src/db/tasks.js";
import { authoriseExecutionIdentity } from "../../src/agent-pool/execution-identity.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void, admin: AuthenticatedPrincipal, alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal;
let clock: number; const realNow = Date.now;
function actor(id: string): AuthenticatedPrincipal {
  const user=getUser(getDb(),id)!, login=createWebSession(`token-${id}`,id,3600,"passkey");
  return { kind:"user",mode:"family-shared",userId:id,username:user.username,displayName:user.display_name,role:user.role,
    homeChatJid:user.home_chat_jid,authentication:{method:"passkey",sessionId:login.session_id!,expiresAt:login.expires_at} };
}
beforeEach(() => {
  ws=createTempWorkspace("family-executions-"); restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  mkdirSync(join(ws.workspace,".piclaw")); writeFileSync(join(ws.workspace,".piclaw/config.json"),JSON.stringify({domains:{access:{mode:"family-shared"}}}));
  closeDatabase();initDatabase();admin=actor("default");
  [alice,bob]=["alice","bob"].map(name=>{
    const user=provisionFamilyAccount(getDb(),admin,{username:name,displayName:name});
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id,name);
    updateManagedAccount(getDb(),admin,user.id,{enabled:true},{totp:false,passkey:true,rpId:"family.local"});return actor(user.id);
  });
  clock=realNow()+10;Date.now=()=>clock;
});
afterEach(()=>{Date.now=realNow;closeDatabase();restore();ws.cleanup();});
function reservation(owner=alice,chat=owner.homeChatJid!) {
  const ids=createFamilyScheduledTask(getDb(),owner,chat,{prompt:`private prompt for ${owner.username}`,scheduled_for:new Date(clock+1000).toISOString(),allowed_tools:["read","messages"]});
  clock+=1000;return {...ids,lease:claim(getDb(),ids.grant_id,"worker")};
}
function snapshot(database=getDb()) {
  return JSON.stringify(["family_scheduled_occurrences","family_scheduled_occurrence_events","family_scheduled_executions","family_scheduled_results","family_scheduled_execution_events"].map(name=>database.query(`SELECT * FROM ${name} ORDER BY rowid`).all()));
}
const result = {status:"success" as const,text:"private result\nwith exact formatting"};

test('owner cancellation is immutable and idempotent, blocks all future authority and preserves original approving login',()=>{
  const db=getDb(),cap=begin(db,reservation().lease),initialLogin=alice.authentication.sessionId;
  for(const viewer of [bob,admin])expect(()=>cancel(db,viewer,cap.execution_id)).toThrow();
  expect(cancel(db,alice,cap.execution_id)).toEqual({execution_id:cap.execution_id,cancelled:true,created:true});
  expect(cancel(db,alice,cap.execution_id).created).toBe(false);expect(read(db,alice,cap.execution_id)).toMatchObject({state:'cancelled',result:null});
  expect(listOwnFamilyScheduledResults(db,alice).items[0]!.state).toBe('cancelled');
  for(const attempt of [()=>start(db,cap),()=>settle(db,cap,result),()=>publishOwnFamilyScheduledResult(db,alice,cap.execution_id)])expect(attempt).toThrow();
  db.query('DELETE FROM web_sessions WHERE user_id=?').run(alice.userId);expect(()=>cancel(db,alice,cap.execution_id)).toThrow();
  alice=actor(alice.userId);expect(cancel(db,alice,cap.execution_id).created).toBe(false);expect(db.query('SELECT login_session_id FROM family_scheduled_cancellations').get()).toEqual({login_session_id:initialLogin});
  clock+=900000;expect(recover(db)).toEqual({recorded:0});expect(read(db,alice,cap.execution_id).state).toBe('cancelled');
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(clock).toISOString(),alice.authentication.sessionId!);
  expect(cancel(db,alice,cap.execution_id).created).toBe(false);expect(db.query('SELECT login_session_id FROM family_scheduled_cancellations').get()).toEqual({login_session_id:initialLogin});
  expect(()=>db.exec('UPDATE family_scheduled_cancellations SET created_at=created_at+1')).toThrow('immutable');expect(()=>db.exec('DELETE FROM family_scheduled_cancellations')).toThrow('cannot be deleted');
  expect(()=>db.query('INSERT INTO family_scheduled_expiries VALUES (?,?)').run(cap.execution_id,clock)).toThrow('cancelled');
});

test('cancellation requires recent live owner and active target, never overwrites other terminal outcomes',()=>{
  const db=getDb(),done=begin(db,reservation().lease);settle(db,done,result);
  const interrupted=begin(db,reservation().lease);start(db,interrupted).markInterrupted();
  const cap=begin(db,reservation().lease),root=createOwnedRoot(db,alice,'cancel-archive'),archived=begin(db,reservation(alice,root.chat_jid).lease);archiveOwnedSession(db,alice,root.chat_jid);
  for(const entry of [done,interrupted,archived])expect(()=>cancel(db,alice,entry.execution_id)).toThrow();
  clock+=300001;expect(()=>cancel(db,alice,cap.execution_id)).toThrow();clock-=300001;
  db.query('UPDATE users SET enabled=0 WHERE id=?').run(alice.userId);expect(()=>cancel(db,alice,cap.execution_id)).toThrow();db.query('UPDATE users SET enabled=1 WHERE id=?').run(alice.userId);
  // Owner cancellation may remove remaining authority even if the grant is already revoked.
  expect(cancel(db,alice,cap.execution_id).created).toBe(true);
  expect(db.query('SELECT count(*) n FROM family_scheduled_cancellations').get()).toEqual({n:1});
});

test('cancellation races serially with settlement, rolls back on storage failure, and survives reopen',()=>{
  const db=getDb(),cap=begin(db,reservation().lease),admitted=start(db,cap),path=join(ws.workspace,'cancel.sqlite');
  db.exec("CREATE TRIGGER fail_cancel BEFORE INSERT ON family_scheduled_cancellations BEGIN SELECT RAISE(ABORT,'cancel failed'); END");expect(()=>cancel(db,alice,cap.execution_id)).toThrow('cancel failed');
  expect(read(db,alice,cap.execution_id).state).toBe('unsettled');db.exec('DROP TRIGGER fail_cancel');db.query('VACUUM INTO ?').run(path);
  const one=new Database(path),two=new Database(path);
  try{one.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10');two.exec('PRAGMA busy_timeout=10');one.exec('BEGIN IMMEDIATE');
    try{cancel(one,alice,cap.execution_id);expect(()=>settle(two,cap,result)).toThrow();}finally{one.exec('COMMIT');}
    expect(()=>settle(two,cap,result)).toThrow();expect(cancel(two,alice,cap.execution_id).created).toBe(false);
  }finally{one.close();two.close();}
  const reopened=new Database(path);try{expect(read(reopened,alice,cap.execution_id).state).toBe('cancelled');expect(()=>start(reopened,cap)).toThrow();}finally{reopened.close();}
  cancel(db,alice,cap.execution_id);admitted.markInterrupted();expect(db.query('SELECT count(*) n FROM family_scheduled_interruptions').get()).toEqual({n:0});
  expect(()=>db.query("INSERT INTO family_scheduled_execution_events VALUES (?,'settle',?)").run(cap.execution_id,clock)).toThrow('cancelled');
});

test('cancellation exact expiry and clock rollback boundaries fail closed without reviving authority',()=>{
  const db=getDb(),cap=begin(db,reservation().lease),at=clock;
  // Refresh fixture authentication timestamps in-place only to isolate the expiry predicate.
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(at+900000).toISOString(),alice.authentication.sessionId!);
  clock=at+900000;expect(()=>cancel(db,alice,cap.execution_id)).toThrow();clock=at;
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(at).toISOString(),alice.authentication.sessionId!);
  clock++;cancel(db,alice,cap.execution_id);clock=at;expect(()=>read(db,alice,cap.execution_id)).toThrow();expect(()=>settle(db,cap,result)).toThrow();
});

test('only a committed admission returns interruption closure; exact retries retain receipt and deny model or result authority',()=>{
  const db=getDb(),cap=begin(db,reservation().lease);expect(readFamilyScheduledDispatch(db,cap)).not.toHaveProperty('markInterrupted');
  db.exec("CREATE TRIGGER fail_start BEFORE INSERT ON family_scheduled_dispatches BEGIN SELECT RAISE(ABORT,'no start'); END");expect(()=>start(db,cap)).toThrow('no start');
  expect(db.query('SELECT count(*) n FROM family_scheduled_interruptions').get()).toEqual({n:0});db.exec('DROP TRIGGER fail_start');
  const admitted=start(db,cap);expect(admitted.identity).not.toHaveProperty('markInterrupted');expect(admitted.identity.provenance).not.toHaveProperty('token');
  clock++;admitted.markInterrupted();const receipt=db.query('SELECT * FROM family_scheduled_interruptions').get();clock++;admitted.markInterrupted();expect(db.query('SELECT * FROM family_scheduled_interruptions').get()).toEqual(receipt);
  expect(read(db,alice,cap.execution_id)).toMatchObject({state:'interrupted',result:null});expect(listOwnFamilyScheduledResults(db,alice).items[0]!.state).toBe('interrupted');
  for(const viewer of [bob,admin])expect(()=>read(db,viewer,cap.execution_id)).toThrow();
  expect(()=>readFamilyScheduledDispatch(db,cap)).toThrow();expect(()=>start(db,cap)).toThrow();expect(()=>settle(db,cap,result)).toThrow();expect(()=>publishOwnFamilyScheduledResult(db,alice,cap.execution_id)).toThrow();
  clock+=900000;expect(recover(db)).toEqual({recorded:0});admitted.markInterrupted();
  clock-=900001;expect(()=>readFamilyScheduledDispatch(db,cap)).toThrow();
});

test('interruption recording survives revoked account/grant authority but not mode or invalid clock; owner access stays live',()=>{
  const db=getDb(),prepared=reservation(),cap=begin(db,prepared.lease),admitted=start(db,cap),at=clock;
  revokeFamilyScheduledGrant(db,alice,prepared.grant_id);db.query('UPDATE users SET enabled=0 WHERE id=?').run(alice.userId);
  const config=join(ws.workspace,'.piclaw/config.json');
  for(const text of ['{',JSON.stringify({domains:{access:{mode:'single-user'}}}),JSON.stringify({domains:{access:{mode:'isolated-containers'}}})]){writeFileSync(config,text);expect(()=>admitted.markInterrupted()).toThrow();}
  writeFileSync(config,JSON.stringify({domains:{access:{mode:'family-shared'}}}));
  for(const invalid of [at-1,NaN,Infinity]){clock=invalid;expect(()=>admitted.markInterrupted()).toThrow();}
  clock=at+900000;admitted.markInterrupted();expect(()=>read(db,alice,cap.execution_id)).toThrow();
  db.query('UPDATE users SET enabled=1 WHERE id=?').run(alice.userId);expect(read(db,alice,cap.execution_id).state).toBe('interrupted');
  expect(()=>settle(db,cap,result)).toThrow();expect(recover(db)).toEqual({recorded:0});
});

test('interruption never overwrites settled or expired history and raw conflicts are fenced',()=>{
  const db=getDb(),complete=begin(db,reservation().lease),a=start(db,complete);settle(db,complete,result);
  const expire=begin(db,reservation().lease),b=start(db,expire),stop=begin(db,reservation().lease),c=start(db,stop);c.markInterrupted();
  a.markInterrupted();clock+=900000;expect(recover(db)).toEqual({recorded:1});b.markInterrupted();
  expect(db.query('SELECT execution_id FROM family_scheduled_interruptions').all()).toEqual([{execution_id:stop.execution_id}]);
  expect(read(db,alice,complete.execution_id).result?.text).toBe(result.text);expect(read(db,alice,expire.execution_id).state).toBe('expired');
  expect(()=>db.query('INSERT INTO family_scheduled_expiries VALUES (?,?)').run(stop.execution_id,clock)).toThrow('terminal');
  expect(()=>db.query('INSERT INTO family_scheduled_results VALUES (?,?,?,?,?)').run(stop.execution_id,'error','x','a'.repeat(64),clock)).toThrow('terminal');
  expect(()=>db.query("INSERT INTO family_scheduled_execution_events VALUES (?,'settle',?)").run(stop.execution_id,clock)).toThrow('terminal');
  expect(()=>db.exec('UPDATE family_scheduled_interruptions SET created_at=created_at+1')).toThrow('immutable');expect(()=>db.exec('DELETE FROM family_scheduled_interruptions')).toThrow('cannot be deleted');
  for(const id of [complete.execution_id,expire.execution_id])expect(()=>db.query('INSERT INTO family_scheduled_interruptions SELECT execution_id,started_at,? FROM family_scheduled_dispatches WHERE execution_id=?').run(clock,id)).toThrow();
});

test('interruption receipt rollback, start binding and reopened terminality without closure persistence',()=>{
  const db=getDb(),cap=begin(db,reservation().lease),admitted=start(db,cap),path=join(ws.workspace,'interrupted.sqlite');
  db.exec("CREATE TRIGGER fail_interruption BEFORE INSERT ON family_scheduled_interruptions BEGIN SELECT RAISE(ABORT,'record failed'); END");expect(()=>admitted.markInterrupted()).toThrow('record failed');
  expect(read(db,alice,cap.execution_id).state).toBe('unsettled');db.exec('DROP TRIGGER fail_interruption');
  expect(()=>db.query('INSERT INTO family_scheduled_interruptions VALUES (?,?,?)').run(cap.execution_id,clock+1,clock+1)).toThrow();
  initializeFamilyScheduledInterruptions(db);expect(db.query('SELECT count(*) n FROM family_scheduled_interruptions').get()).toEqual({n:0});
  admitted.markInterrupted();db.query('VACUUM INTO ?').run(path);const reopened=new Database(path);
  try{initializeFamilyScheduledInterruptions(reopened);expect(read(reopened,alice,cap.execution_id).state).toBe('interrupted');expect(()=>start(reopened,cap)).toThrow();expect(()=>settle(reopened,cap,result)).toThrow();}finally{reopened.close();}
  db.exec('DROP TRIGGER family_scheduled_interruption_immutable');db.query('UPDATE family_scheduled_interruptions SET created_at=?').run(clock+1);expect(()=>read(db,alice,cap.execution_id)).toThrow();expect(()=>admitted.markInterrupted()).toThrow();
});

test('SQLite concurrent result writer fences interruption and nested admission cannot mint authority before commit',()=>{
  const db=getDb(),cap=begin(db,reservation().lease),path=join(ws.workspace,'interruption-race.sqlite');
  let escaped:ReturnType<typeof start>|undefined;
  expect(()=>db.transaction(()=>{escaped=start(db,cap);}).immediate()).toThrow('Session access denied');
  expect(escaped).toBeUndefined();expect(db.query('SELECT count(*) n FROM family_scheduled_dispatches').get()).toEqual({n:0});db.query('VACUUM INTO ?').run(path);const one=new Database(path),two=new Database(path);
  try{one.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10');two.exec('PRAGMA busy_timeout=10');const admitted=start(one,cap);
    two.exec('BEGIN IMMEDIATE');try{settle(two,cap,result);expect(()=>admitted.markInterrupted()).toThrow();}finally{two.exec('COMMIT');}
    admitted.markInterrupted();expect(one.query('SELECT count(*) n FROM family_scheduled_interruptions').get()).toEqual({n:0});expect(read(one,alice,cap.execution_id).state).toBe('settled');
  }finally{one.close();two.close();}
});

test("handoff atomically consumes reservation and creates token-free durable binding, without model authority",()=>{
  const db=getDb(), prepared=reservation(), cap=begin(db,prepared.lease);
  expect(cap.token).toMatch(/^[\w-]{43}$/); expect(Object.isFrozen(cap)).toBe(true);
  expect(snapshot()).not.toContain(cap.token); expect(snapshot()).not.toContain(prepared.lease.token); expect(snapshot()).not.toContain("private prompt");
  expect(db.query("SELECT state FROM family_scheduled_occurrences").get()).toEqual({state:"consumed"});
  expect(db.query("SELECT occurrence_id,owner_user_id,initiated_by_user_id,execution_service FROM family_scheduled_executions").get()).toEqual({occurrence_id:prepared.lease.occurrence_id,owner_user_id:alice.userId,initiated_by_user_id:alice.userId,execution_service:"scheduler"});
  expect(read(db,alice,cap.execution_id).state).toBe("unsettled"); expect(getTaskById(prepared.task_id)?.status).toBe("paused");
  expect(()=>begin(db,prepared.lease)).toThrow();expect(()=>claim(db,prepared.grant_id,"other")).toThrow();
  expect(()=>authoriseExecutionIdentity(db,"family-shared",alice.homeChatJid!,{kind:"scheduled",actorUserId:alice.userId,ownerUserId:alice.userId,chatJid:alice.homeChatJid!,...cap} as any)).toThrow();
});

test("handoff audit failure rolls consumption back; separate prior consumption cannot fabricate a handoff",()=>{
  const db=getDb(),prepared=reservation(),before=snapshot();
  db.exec("CREATE TRIGGER fail_begin BEFORE INSERT ON family_scheduled_execution_events BEGIN SELECT RAISE(ABORT,'begin audit failed'); END");
  expect(()=>begin(db,prepared.lease)).toThrow("begin audit failed");expect(snapshot()).toBe(before);
  db.exec("DROP TRIGGER fail_begin"); consume(db,prepared.lease); expect(()=>begin(db,prepared.lease)).toThrow();
  expect(db.query("SELECT count(*) n FROM family_scheduled_executions").get()).toEqual({n:0});
});

test("settlement is exact and idempotent, owner readable, bounded and immutable",()=>{
  const db=getDb(),cap=begin(db,reservation().lease);
  for(const invalid of [{status:"other",text:"x"},{...result,text:"é".repeat(51201)},{...result,text:"bad\0text"},{...result,chat_jid:bob.homeChatJid},{...result,owner:alice.userId}]) expect(()=>settle(db,cap,invalid as any)).toThrow();
  expect(settle(db,cap,result)).toEqual({execution_id:cap.execution_id,created:true});const before=snapshot();
  expect(settle(db,cap,result)).toEqual({execution_id:cap.execution_id,created:false});expect(snapshot()).toBe(before);
  for(const changed of [{...result,text:result.text+" "},{...result,status:"error" as const}]) expect(()=>settle(db,cap,changed)).toThrow();
  expect(read(db,alice,cap.execution_id)).toMatchObject({state:"settled",owner_user_id:alice.userId,owner_display_name:"alice",result:{...result,created_at:clock}});
  expect(()=>db.exec("UPDATE family_scheduled_results SET text='replace'")).toThrow("immutable");expect(()=>db.exec("DELETE FROM family_scheduled_results")).toThrow("cannot be deleted");
  const empty=begin(db,reservation().lease); expect(settle(db,empty,{status:"error",text:""}).created).toBe(true);
});

test("foreign targets, stale/wrong tokens and added capability fields cannot settle or read",()=>{
  const db=getDb(),a=begin(db,reservation().lease),b=begin(db,reservation(bob).lease),before=snapshot();
  for(const invalid of [{...a,token:b.token},{...a,execution_id:b.execution_id},{...a,token:"x".repeat(43)},{...a,token:"short"},{...a,owner:alice.userId}]) expect(()=>settle(db,invalid,result)).toThrow();
  for(const viewer of [bob,admin]) expect(()=>read(db,viewer,a.execution_id)).toThrow();
  expect(snapshot()).toBe(before); settle(db,a,result); expect(()=>read(db,bob,a.execution_id)).toThrow();
});

test("live revocation, account disable, payload changes and policy narrowing deny settlement; prior results remain owned history",()=>{
  const db=getDb();
  const prepared=reservation(),cap=begin(db,prepared.lease);settle(db,cap,result); revokeFamilyScheduledGrant(db,alice,prepared.grant_id);
  expect(()=>settle(db,cap,result)).toThrow();expect(read(db,alice,cap.execution_id).result?.text).toBe(result.text);
  const disabled=begin(db,reservation().lease);db.query("UPDATE users SET enabled=0 WHERE id=?").run(alice.userId);
  expect(()=>settle(db,disabled,result)).toThrow();expect(()=>read(db,alice,cap.execution_id)).toThrow();db.query("UPDATE users SET enabled=1 WHERE id=?").run(alice.userId);
  expect(()=>settle(db,disabled,result)).toThrow();
  const changed=reservation(), changedCap=begin(db,changed.lease);updateTask(changed.task_id,{prompt:"modified"}); expect(()=>settle(db,changedCap,result)).toThrow();
  const policy=begin(db,reservation().lease);
  updateAdminToolPolicy(db,admin,alice.userId,{confirm_username:"alice",expected_revision:0,denied_tools:["read"]}); expect(()=>settle(db,policy,result)).toThrow();
});

test("logout does not block settlement, owner retrieval needs a live login and preserves labels across renames",()=>{
  const db=getDb(),cap=begin(db,reservation().lease); db.query("DELETE FROM web_sessions WHERE user_id=?").run(alice.userId);
  expect(settle(db,cap,result).created).toBe(true);expect(()=>read(db,alice,cap.execution_id)).toThrow();
  db.query("UPDATE users SET username='renamed',display_name='Renamed owner' WHERE id=?").run(alice.userId);alice=actor(alice.userId);
  expect(read(db,alice,cap.execution_id)).toMatchObject({owner_username:"alice",owner_display_name:"alice",state:"settled"});
});

test("expiry and clock rollback deny capability use; owner sees expired-unsettled without replay",()=>{
  const db=getDb(),prepared=reservation(),cap=begin(db,prepared.lease),created=clock;
  clock--;expect(()=>settle(db,cap,result)).toThrow();clock=created+900000;
  expect(()=>settle(db,cap,result)).toThrow();expect(read(db,alice,cap.execution_id)).toMatchObject({state:"expired-unsettled",result:null});
  expect(()=>claim(db,prepared.grant_id,"other")).toThrow();
});

test("settlement audit rollback preserves unsettled state, and identical retry survives database reopen",()=>{
  const db=getDb(),cap=begin(db,reservation().lease),before=snapshot();
  db.exec("CREATE TRIGGER fail_settle BEFORE INSERT ON family_scheduled_execution_events WHEN NEW.kind='settle' BEGIN SELECT RAISE(ABORT,'settle audit failed'); END");
  expect(()=>settle(db,cap,result)).toThrow("settle audit failed"); expect(snapshot()).toBe(before);db.exec("DROP TRIGGER fail_settle");
  const path=join(ws.workspace,"handoff.sqlite");db.query("VACUUM INTO ?").run(path); const one=new Database(path),two=new Database(path);
  try {one.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000");two.exec("PRAGMA busy_timeout=1000");
    one.exec("BEGIN IMMEDIATE");try {expect(()=>settle(two,cap,result)).toThrow();}finally{one.exec("ROLLBACK");}
    expect(settle(one,cap,result).created).toBe(true);expect(settle(two,cap,result).created).toBe(false);
  }finally{one.close();two.close();}
  const reopened=new Database(path);try{initializeFamilyScheduledExecutions(reopened);expect(settle(reopened,cap,result).created).toBe(false);expect(read(reopened,alice,cap.execution_id).result?.text).toBe(result.text);}finally{reopened.close();}
});

test("archived target denies historic retrieval and corrupt result or missing audit never returns content",()=>{
  const db=getDb(),root=createOwnedRoot(db,alice,"archive-result"),prepared=reservation(alice,root.chat_jid),cap=begin(db,prepared.lease);
  settle(db,cap,result);archiveOwnedSession(db,alice,root.chat_jid);expect(()=>read(db,alice,cap.execution_id)).toThrow();
  const other=begin(db,reservation().lease);settle(db,other,result);
  db.exec("DROP TRIGGER family_scheduled_result_immutable");db.query("UPDATE family_scheduled_results SET text='tampered' WHERE execution_id=?").run(other.execution_id);
  expect(()=>read(db,alice,other.execution_id)).toThrow(); expect(()=>settle(db,other,result)).toThrow();
});

test("mode denial and supplied database isolation preserve existing durable records",()=>{
  const db=getDb(),cap=begin(db,reservation().lease),before=snapshot(),path=join(ws.workspace,".piclaw/config.json");
  for(const text of ['{',JSON.stringify({domains:{access:{mode:"single-user"}}}),JSON.stringify({domains:{access:{mode:"isolated-containers"}}})]) {
    writeFileSync(path,text);expect(()=>settle(db,cap,result)).toThrow();expect(()=>read(db,alice,cap.execution_id)).toThrow();expect(snapshot()).toBe(before);
  }
});

test("consumed timestamp and branch snapshots cannot drift while retaining settlement capability",()=>{
  const db=getDb(),prepared=reservation(),cap=begin(db,prepared.lease);
  db.exec("DROP TRIGGER family_scheduled_occurrence_terminal; DROP TRIGGER family_scheduled_occurrence_event_immutable");
  db.query("UPDATE family_scheduled_occurrences SET updated_at=updated_at+1 WHERE id=?").run(prepared.lease.occurrence_id);
  db.query("UPDATE family_scheduled_occurrence_events SET created_at=created_at+1 WHERE occurrence_id=? AND kind='consume'").run(prepared.lease.occurrence_id);
  clock++;
  expect(()=>settle(db,cap,result)).toThrow();
  const other=begin(db,reservation().lease);settle(db,other,result);
  db.exec("DROP TRIGGER family_scheduled_execution_immutable");
  db.query("UPDATE family_scheduled_executions SET target_branch_id='different' WHERE id=?").run(other.execution_id);
  expect(()=>settle(db,other,result)).toThrow();expect(()=>read(db,alice,other.execution_id)).toThrow();
});

test("settled retry after expiry fails but the owner can still read the committed result",()=>{
  const db=getDb(),cap=begin(db,reservation().lease);settle(db,cap,result);clock+=900000;
  expect(()=>settle(db,cap,result)).toThrow();expect(read(db,alice,cap.execution_id)).toMatchObject({state:"settled",result:{text:result.text}});
});

test("explicit expiry recovery preserves settled history and terminally records started and never-started handoffs",()=>{
  const db=getDb(),settled=begin(db,reservation().lease);settle(db,settled,result);
  const unstarted=begin(db,reservation().lease),started=begin(db,reservation().lease);start(db,started);
  expect(recover(db)).toEqual({recorded:0});clock+=900000;
  expect(recover(db)).toEqual({recorded:2});const before=db.query('SELECT * FROM family_scheduled_expiries ORDER BY execution_id').all();
  expect(recover(db)).toEqual({recorded:0});expect(db.query('SELECT * FROM family_scheduled_expiries ORDER BY execution_id').all()).toEqual(before);
  expect(read(db,alice,settled.execution_id).state).toBe('settled');
  for(const cap of [unstarted,started]){
    expect(read(db,alice,cap.execution_id)).toMatchObject({state:'expired',result:null,publication_recorded:false});
    expect(()=>settle(db,cap,result)).toThrow();expect(()=>start(db,cap)).toThrow();expect(()=>publishOwnFamilyScheduledResult(db,alice,cap.execution_id)).toThrow();
  }
  const list=listOwnFamilyScheduledResults(db,alice);expect(list.items.filter(i=>i.state==='expired')).toHaveLength(2);
  expect(JSON.stringify(list)).not.toContain('private prompt');expect(JSON.stringify(before)).not.toContain(started.token);
  expect(db.query('SELECT count(*) n FROM messages').get()).toEqual({n:0});expect(db.query('SELECT count(*) n FROM family_scheduled_dispatches').get()).toEqual({n:1});
  expect(db.query("SELECT count(*) n FROM scheduled_tasks WHERE status!='paused'").get()).toEqual({n:0});
  clock-=900000;expect(()=>settle(db,unstarted,result)).toThrow();expect(()=>start(db,unstarted)).toThrow();expect(()=>read(db,alice,unstarted.execution_id)).toThrow();
});

test("expiry recording is mode-gated maintenance, not owner execution or publication authority",()=>{
  const db=getDb(),prepared=reservation(),cap=begin(db,prepared.lease);
  const root=createOwnedRoot(db,alice,'expired-archive'),other=begin(db,reservation(alice,root.chat_jid).lease);revokeFamilyScheduledGrant(db,alice,prepared.grant_id);
  db.query('UPDATE users SET enabled=0 WHERE id=?').run(alice.userId);clock+=900000;
  const config=join(ws.workspace,'.piclaw/config.json');
  for(const mode of ['single-user','isolated-containers','invalid']){
    writeFileSync(config,mode==='invalid'?'{':JSON.stringify({domains:{access:{mode}}}));expect(()=>recover(db)).toThrow();
    expect(db.query('SELECT count(*) n FROM family_scheduled_expiries').get()).toEqual({n:0});
  }
  writeFileSync(config,JSON.stringify({domains:{access:{mode:'family-shared'}}}));expect(recover(db)).toEqual({recorded:2});
  for(const viewer of [alice,bob,admin])expect(()=>read(db,viewer,cap.execution_id)).toThrow();
  db.query('UPDATE users SET enabled=1 WHERE id=?').run(alice.userId);expect(read(db,alice,cap.execution_id).state).toBe('expired');
  expect(()=>publishOwnFamilyScheduledResult(db,alice,cap.execution_id)).toThrow();
  archiveOwnedSession(db,alice,root.chat_jid);expect(()=>read(db,alice,other.execution_id)).toThrow();expect(listOwnFamilyScheduledResults(db,alice).items.some(i=>i.execution_id===other.execution_id)).toBe(false);
});

test("expiry batches are bounded, ordered, atomic, idempotent and initialisation does not perform recovery",()=>{
  const db=getDb(),caps=[];
  for(let i=0;i<101;i++)caps.push(begin(db,reservation().lease));
  clock+=900000;initializeFamilyScheduledExpiry(db);expect(db.query('SELECT count(*) n FROM family_scheduled_expiries').get()).toEqual({n:0});
  const expected=db.query('SELECT id FROM family_scheduled_executions ORDER BY expires_at,id LIMIT 100').all() as Array<{id:string}>;
  db.exec(`CREATE TRIGGER fail_expiry BEFORE INSERT ON family_scheduled_expiries WHEN NEW.execution_id='${expected[1]!.id}' BEGIN SELECT RAISE(ABORT,'expiry write failed'); END`);
  expect(()=>recover(db)).toThrow('expiry write failed');expect(db.query('SELECT count(*) n FROM family_scheduled_expiries').get()).toEqual({n:0});db.exec('DROP TRIGGER fail_expiry');
  expect(recover(db)).toEqual({recorded:100});expect(db.query('SELECT execution_id AS id FROM family_scheduled_expiries ORDER BY rowid').all()).toEqual(expected);
  expect(recover(db)).toEqual({recorded:1});expect(recover(db)).toEqual({recorded:0});
  expect(()=>db.exec('UPDATE family_scheduled_expiries SET created_at=created_at+1')).toThrow('immutable');expect(()=>db.exec('DELETE FROM family_scheduled_expiries')).toThrow('cannot be deleted');
});

test("SQLite write serialisation and symmetric triggers exclude result/expiry and start-after-expiry conflicts",()=>{
  const db=getDb(),cap=begin(db,reservation().lease),other=begin(db,reservation().lease),path=join(ws.workspace,'expiry-race.sqlite');settle(db,other,result);
  expect(()=>db.query('INSERT INTO family_scheduled_expiries VALUES (?,?)').run(cap.execution_id,clock)).toThrow();clock+=900000;
  expect(()=>db.query('INSERT INTO family_scheduled_expiries VALUES (?,?)').run(other.execution_id,clock)).toThrow();
  db.query('VACUUM INTO ?').run(path);const one=new Database(path),two=new Database(path);
  try{
    one.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10');two.exec('PRAGMA busy_timeout=10');
    one.exec('BEGIN IMMEDIATE');try{expect(()=>recover(two)).toThrow();}finally{one.exec('ROLLBACK');}
    expect(recover(two)).toEqual({recorded:1});expect(recover(one)).toEqual({recorded:0});
    expect(()=>one.query('INSERT INTO family_scheduled_results VALUES (?,?,?,?,?)').run(cap.execution_id,'success','late','a'.repeat(64),clock-900000)).toThrow('terminal');
    expect(()=>one.query('INSERT INTO family_scheduled_dispatches VALUES (?,?)').run(cap.execution_id,clock)).toThrow('terminal');
    expect(read(one,alice,other.execution_id).result?.text).toBe(result.text);
  }finally{one.close();two.close();}
});

test("corrupt expiry or unmatched settle audit fails closed without exposing content or committing recovery",()=>{
  const db=getDb(),cap=begin(db,reservation().lease),other=begin(db,reservation().lease);clock+=900000;
  db.query("INSERT INTO family_scheduled_execution_events VALUES (?,'settle',?)").run(cap.execution_id,clock-900000);
  expect(()=>recover(db)).toThrow();expect(db.query('SELECT count(*) n FROM family_scheduled_expiries').get()).toEqual({n:0});
  db.exec('DROP TRIGGER family_scheduled_expiry_valid');db.query('INSERT INTO family_scheduled_expiries VALUES (?,?)').run(other.execution_id,clock+1);
  expect(()=>read(db,alice,other.execution_id)).toThrow();
});

test("SIGKILL before and after recovery commit preserves terminality after reopen without replay",async()=>{
  const db=getDb(),unstarted=begin(db,reservation().lease),started=begin(db,reservation().lease);start(db,started);clock+=900000;
  for(const phase of ['before-commit','after-commit']){
    const path=join(ws.workspace,`crash-${phase}.sqlite`);db.query('VACUUM INTO ?').run(path);
    const child=Bun.spawn([process.execPath,join(import.meta.dir,'../fixtures/family-expiry-crash.ts'),path,String(clock),phase],{env:{...process.env},stdout:'pipe',stderr:'pipe'});
    const stderr=new Response(child.stderr).text(),reader=child.stdout.getReader();let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const ready=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Crash fixture did not become ready')),10000);})]);
      expect(new TextDecoder().decode(ready.value)).toContain('EXPIRY_CRASH_READY');child.kill('SIGKILL');expect(await child.exited).not.toBe(0);
      // Inherited test configuration may log compatibility warnings; never hide actual errors.
      for(const line of (await stderr).trim().split('\n').filter(Boolean))expect(JSON.parse(line).level).toBe('warn');
    }finally{clearTimeout(timer);child.kill('SIGKILL');await child.exited;reader.releaseLock();}
    const reopened=new Database(path);
    try{
      expect(recover(reopened)).toEqual({recorded:phase==='before-commit'?2:0});expect(recover(reopened)).toEqual({recorded:0});
      for(const cap of [unstarted,started]){expect(read(reopened,alice,cap.execution_id).state).toBe('expired');expect(()=>readFamilyScheduledDispatch(reopened,cap)).toThrow();expect(()=>settle(reopened,cap,result)).toThrow();}
      expect(reopened.query('SELECT count(*) n FROM family_scheduled_results').get()).toEqual({n:0});expect(reopened.query('SELECT count(*) n FROM family_scheduled_dispatches').get()).toEqual({n:1});
    }finally{reopened.close();}
  }
},30000);
