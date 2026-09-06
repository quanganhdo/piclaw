import {beforeEach,afterEach,expect,test} from 'bun:test';
import '../helpers.js';
import {getDb,initDatabase,closeDatabase} from '../../src/db/connection.js';
import {createUser,getUser} from '../../src/db/users.js';
import {createWebSession} from '../../src/db/web-sessions.js';
import {createTask} from '../../src/db/tasks.js';
import {createMedia,attachMediaToMessage} from '../../src/db/media.js';
import {authoriseOwnedMedia} from '../../src/db/owned-resource-reads.js';
import {readAccessState} from '../../src/db/access-state.js';
import {readAccessMigrationInventory,prepareAccessMigrationCopy,validateAccessMigrationPlan} from '../../src/db/access-migration-plan.js';
import {readMigrationResourceInventory,RESOURCE_MIGRATION_POLICY} from '../../src/db/access-resource-migration.js';
import {resolveRequestPrincipal} from '../../src/channels/web/auth/principal.js';

let bob:string;
beforeEach(()=>{closeDatabase();initDatabase();const db=getDb();bob=createUser(db,{username:'bob',displayName:'Bob'}).id;
  for(const [jid,name] of [['web:default','main'],['web:bob','bob'],['web:extra','extra']]){db.query("INSERT INTO chats(jid,name,last_message_time) VALUES (?,?,'now')").run(jid!,name!);db.query("INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES (?,?,?,?,'now','now')").run(jid!,jid!,jid!,name!);}
});
afterEach(()=>closeDatabase());
function plan(){const value=readAccessMigrationInventory(getDb()).plan;for(const a of value.assignments)a.owner_user_id=a.root_chat_jid==='web:bob'?bob:'default';return {...value,version:3,child_sessions:[],resource_policy:RESOURCE_MIGRATION_POLICY};}
function message(jid:string,id:string,thread:number|null=null){return Number(getDb().query('INSERT INTO messages(id,chat_jid,content,timestamp,is_bot_message,thread_id) VALUES (?,?,?, ?,0,?)').run(id,jid,'PRIVATE_MESSAGE','2026-09-06T00:00:00.000Z',thread).lastInsertRowid);}
function media(){return createMedia('private.png','image/png',new Uint8Array([1,2,3]),undefined,{private:'PRIVATE_METADATA'});}
function task(id:string,status:'active'|'paused'|'completed'='active'){createTask({id,chat_jid:'web:default',prompt:'PRIVATE_TASK',task_kind:'agent',schedule_type:'interval',schedule_value:'60000',next_run:'2026-09-07T00:00:00.000Z',status,created_at:'2026-09-06T00:00:00.000Z'});}

test('resource inventory reveals counts not content/secrets and fingerprint catches same-count link/status changes',()=>{
  const db=getDb(),a=message('web:default','a'),b=message('web:bob','b'),id=media();attachMediaToMessage(a,[id]);createWebSession('SECRET_COOKIE','default',3600,'passkey');task('task');
  const before=readAccessMigrationInventory(db);const text=JSON.stringify(before);for(const secret of ['PRIVATE_MESSAGE','PRIVATE_TASK','PRIVATE_METADATA','SECRET_COOKIE','private.png'])expect(text).not.toContain(secret);
  expect(before.resources.auth.web_sessions).toBe(1);expect(before.resources.unconsumed_user_messages).toBe(2);
  const reviewed=plan();db.query('UPDATE message_media SET message_rowid=? WHERE media_id=?').run(b,id);expect(()=>validateAccessMigrationPlan(db,reviewed)).toThrow('changed');
  expect(readAccessMigrationInventory(db).snapshot).not.toBe(before.snapshot);
});

test('version-three disposition revokes transient auth, pauses both scheduler heads and quarantines cross-owner/orphan media only',()=>{
  const db=getDb(),a=message('web:default','a'),extra=message('web:extra','extra'),b=message('web:bob','b');
  const own=media(),sameOwner=media(),cross=media(),unlinked=media(),broken=media();
  attachMediaToMessage(a,[own,sameOwner,cross]);attachMediaToMessage(extra,[sameOwner]);attachMediaToMessage(b,[cross]);db.query('INSERT INTO message_media VALUES (?,?)').run(999999,broken);
  createWebSession('OLD_COOKIE','default',3600,'passkey');db.query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES ('default','family.local','kept','KEY')").run();
  db.query("INSERT INTO user_auth_invitations(token_hash,user_id,issuer_user_id,expires_at,state,created_at) VALUES ('hash',?,'default',9999999999999,'issued','now')").run(bob);
  task('active');task('paused','paused');task('completed','completed');
  const messages=db.query('SELECT * FROM messages ORDER BY rowid').all(),payload=db.query("SELECT prompt,revision,next_run FROM scheduled_tasks WHERE id='active'").get();
  prepareAccessMigrationCopy(db,plan());expect(db.query('SELECT * FROM messages ORDER BY rowid').all()).toEqual(messages);expect(db.query('SELECT * FROM web_sessions').all()).toEqual([]);expect(db.query('SELECT * FROM user_auth_invitations').all()).toEqual([]);
  expect(db.query('SELECT credential_id FROM webauthn_credentials').get()).toEqual({credential_id:'kept'});
  expect(db.query("SELECT status FROM scheduled_tasks WHERE id='active'").get()).toEqual({status:'paused'});expect(db.query("SELECT status FROM service_effect_s07_tasks WHERE task_id='active'").get()).toEqual({status:'paused'});expect(db.query("SELECT prompt,revision,next_run FROM scheduled_tasks WHERE id='active'").get()).toEqual(payload);
  expect(db.query('SELECT media_id,reason FROM migration_media_quarantine ORDER BY media_id').all()).toEqual([{media_id:cross,reason:'multiple-owners'},{media_id:unlinked,reason:'unlinked'},{media_id:broken,reason:'unresolved-link'}]);
  const login=createWebSession('NEW_COOKIE','default',3600,'passkey');const actor=resolveRequestPrincipal(new Request('https://family.local',{headers:{cookie:'piclaw_session=fixture'}}),{mode:'family-shared',authEnabled:true},{getSession:()=>login,getUser:()=>getUser(db,'default'),getLocalDisplayName:()=>''})!;
  expect(()=>authoriseOwnedMedia(db,actor,own)).not.toThrow();expect(()=>authoriseOwnedMedia(db,actor,sameOwner)).not.toThrow();for(const id of [cross,unlinked,broken])expect(()=>authoriseOwnedMedia(db,actor,id)).toThrow();
  attachMediaToMessage(a,[unlinked]);expect(()=>authoriseOwnedMedia(db,actor,unlinked)).toThrow(); // Quarantine cannot be bypassed with a later link.
  expect(()=>readAccessState(db)).toThrow('Prepared migration copy');expect(JSON.parse((db.query('SELECT report_json FROM access_resource_migration').get() as any).report_json)).toMatchObject({paused_tasks:1,quarantined_media:3});
});

test('pending runs/followups, bad thread links and mismatched scheduler authority block without changes',()=>{
  const db=getDb();task('task');message('web:default','a');
  db.query("INSERT INTO chat_cursors(chat_jid,inflight_message_id) VALUES ('web:default','a')").run();expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('Unresolved');db.exec("UPDATE chat_cursors SET inflight_message_id=NULL,queued_followups_json='[\"PRIVATE_QUEUED\"]'");expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('Unresolved');expect(JSON.stringify(readMigrationResourceInventory(db))).not.toContain('PRIVATE_QUEUED');db.exec("UPDATE chat_cursors SET queued_followups_json='[]'");
  const foreign=message('web:bob','b');message('web:default','bad-thread',foreign);expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('Unresolved');db.exec("UPDATE messages SET thread_id=NULL");
  db.exec("UPDATE service_effect_s07_tasks SET status='paused'");expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('Unresolved');expect(db.query('SELECT * FROM session_roots').all()).toEqual([]);expect(readAccessState(db).activatedMode).toBe('single-user');
});

test('resource disposition is explicit and any failure rolls back auth revocation, task pause and ownership',()=>{
  const db=getDb();createWebSession('KEEP_COOKIE','default',3600,'passkey');task('task');
  expect(()=>prepareAccessMigrationCopy(db,{...plan(),resource_policy:'allow-all'})).toThrow('policy');
  db.exec("CREATE TRIGGER fail_pause BEFORE UPDATE OF status ON scheduled_tasks BEGIN SELECT RAISE(ABORT,'pause failure'); END");
  expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('pause failure');expect(db.query('SELECT * FROM web_sessions').all()).toHaveLength(1);expect(db.query("SELECT status FROM service_effect_s07_tasks WHERE task_id='task'").get()).toEqual({status:'active'});expect(db.query('SELECT * FROM session_roots').all()).toEqual([]);expect(readAccessState(db).activatedMode).toBe('single-user');
});

test('durable pending sources and notification outbox including scheduled retries block rather than silently discard work',()=>{
  const db=getDb(),now='2026-09-06T00:00:00.000Z';
  db.query("INSERT INTO service_effect_s01_chats(chat_jid) VALUES ('web:default')").run();
  db.query(`INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,accepted_at,provenance_ref,create_wake_intent)
    VALUES ('web:default',1,'source',?,'message','pending','PRIVATE_REF',?,'PRIVATE_PROVENANCE',1)`).run('a'.repeat(64),now);
  expect(readMigrationResourceInventory(db).unresolved.service_effect_s01_sources).toBe(1);expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('Unresolved');
  db.query("UPDATE service_effect_s01_sources SET state='disposed'").run();
  db.query(`INSERT INTO service_effect_s05_outbox(outbox_id,kind,state,idempotency_key,request_hash,provenance_ref,redaction_class,payload_ref,available_at,enqueued_at,state_changed_at,repeatability,certainty)
    VALUES ('notification','notification','pending','key',?,'PRIVATE_PROVENANCE','private','PRIVATE_PAYLOAD',?,?,?,'repeatable','not_applied')`).run('b'.repeat(64),now,now,now);
  expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('Unresolved');
  db.query("UPDATE service_effect_s05_outbox SET state='failed',attempt=1,last_error_tag='retry',result_at=?,retry_at=? WHERE outbox_id='notification'").run(now,'2026-09-07T00:00:00.000Z');
  expect(readMigrationResourceInventory(db).unresolved.service_effect_s05_outbox).toBe(1);expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('Unresolved');
  expect(JSON.stringify(readMigrationResourceInventory(db))).not.toContain('PRIVATE_');expect(db.query('SELECT * FROM session_roots').all()).toEqual([]);
});
