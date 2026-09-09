import { afterEach, beforeEach, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount } from '../../src/db/account-administration.js';
import { getUser } from '../../src/db/users.js';
import { storeMessageInDatabase } from '../../src/db/messages.js';
import { createOwnedRoot, archiveOwnedSession } from '../../src/db/owned-session-lifecycle.js';
import { validateAccessStartup } from '../../src/db/access-state.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';
import type { AuthenticatedPrincipal } from '../../src/core/access-types.js';
import { ChatAccessDenied } from '../../src/db/session-ownership.js';
import { previewOwnFamilyMemorySource as preview, publishOwnFamilyMemory as publish,
  readOwnFamilyMemoryPublication as inspect, withdrawOwnFamilyMemory as withdraw, listSharedFamilyMemory as shared } from '../../src/db/family-memory.js';

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void, config: string;
let admin: AuthenticatedPrincipal, alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal;
function mode(value: string) { writeFileSync(config, JSON.stringify({ domains: { access: { mode: value } } })); }
function actor(id: string): AuthenticatedPrincipal {
  const user = getUser(getDb(),id)!, login = createWebSession(randomUUID(),id,3600,'passkey');
  return { kind:'user',mode:'family-shared',userId:id,username:user.username,displayName:user.display_name,role:user.role,
    homeChatJid:user.home_chat_jid,authentication:{ method:'passkey',sessionId:login.session_id!,expiresAt:login.expires_at } };
}
beforeEach(() => {
  ws=createTempWorkspace('family-memory-'); restore=setEnv({ PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data });
  mkdirSync(join(ws.workspace,'.piclaw')); config=join(ws.workspace,'.piclaw/config.json'); mode('family-shared');
  closeDatabase(); initDatabase(); admin=actor('default');
  [alice,bob]=['alice','bob'].map(name => {
    const user=provisionFamilyAccount(getDb(),admin,{username:name,displayName:name});
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id,name);
    updateManagedAccount(getDb(),admin,user.id,{enabled:true},{totp:false,passkey:true,rpId:'family.local'});
    return actor(user.id);
  });
});
afterEach(() => { closeDatabase(); restore(); ws.cleanup(); });
function message(who=alice,text='private preamble\nShare this fact.\nprivate ending',chat=who.homeChatJid!) {
  const id=randomUUID(); const row=storeMessageInDatabase(getDb(),{id,chat_jid:chat,sender:'assistant',sender_name:'Smith',content:text,timestamp:new Date().toISOString(),is_bot_message:true})!;
  return {chat_jid:chat,message_id:id,message_rowid:row};
}
function input(source=message(),text='Share this fact.') {
  const viewed=preview(getDb(),alice,source);
  return {...source,source_hash:viewed.source_hash,text,request_id:randomUUID(),confirm:true as const};
}
function unrelated() { return JSON.stringify(['messages','messages_fts','message_media','thinking_content','chat_cursors','workspace_index_status',
  'family_workspace_files','family_workspace_fts','family_workspace_index_generation','scheduled_tasks','access_state'].map(t=>getDb().query(`SELECT * FROM ${t}`).all())); }
function ledger(db=getDb()) { return JSON.stringify(['family_memory_publications','family_memory_withdrawals'].map(t=>db.query(`SELECT * FROM ${t} ORDER BY rowid`).all())); }

test('explicit excerpt, immutable publisher attribution, private provenance and no unrelated effects',()=>{
  const source=message(),request=input(source),db=getDb();
  db.query('UPDATE messages SET content_blocks=?,annotations=? WHERE rowid=?').run('[{"text":"block secret"}]','{"text":"annotation secret"}',source.message_rowid);
  db.query("INSERT INTO media(id,filename,content_type,data) VALUES (999,'secret','text/plain',?)").run(new Uint8Array([1]));
  db.query('INSERT INTO message_media(message_rowid,media_id) VALUES (?,999)').run(source.message_rowid);
  const before=unrelated(),first=publish(db,alice,request),saved=ledger();
  expect(first.created).toBe(true); expect(publish(db,alice,request)).toEqual({...first,created:false}); expect(ledger()).toBe(saved);
  const value=shared(db,bob); expect(value.items).toEqual([{publication_id:first.publication_id,publisher:{user_id:alice.userId,username:'alice',display_name:'alice'},
    source_kind:'message-excerpt',text:request.text,published_at:expect.any(String)}]);
  for(const secret of [source.chat_jid,source.message_id,request.source_hash,request.request_id,alice.authentication.sessionId!,'private preamble','private ending','block secret','annotation secret'])expect(JSON.stringify(value)).not.toContain(secret);
  expect(inspect(db,alice,first.publication_id)).toMatchObject({source:{...source,source_hash:request.source_hash},request_id:request.request_id,withdrawn:false});
  for(const who of [bob,admin])expect(()=>inspect(db,who,first.publication_id)).toThrow(ChatAccessDenied);
  expect(unrelated()).toBe(before); expect(()=>validateAccessStartup(db)).toThrow();
});

test('preview and publish reject foreign owners, admins, wrong rows, invalid targets and edited source snapshots',()=>{
  const db=getDb(),src=message(),request=input(src),foreign=message(bob);
  for(const who of [bob,admin]){expect(()=>preview(db,who,src)).toThrow(ChatAccessDenied);expect(()=>publish(db,who,request)).toThrow(ChatAccessDenied);}
  for(const patch of [{chat_jid:bob.homeChatJid!},{message_id:foreign.message_id},{message_rowid:foreign.message_rowid},{message_rowid:0},{chat_jid:' '},{message_rowid:1.5}])expect(()=>preview(db,alice,{...src,...patch})).toThrow(ChatAccessDenied);
  const snapshot=ledger();
  for(const column of ['content','sender','sender_name','timestamp','thread_id','is_bot_message']){
    const old=(db.query(`SELECT ${column} v FROM messages WHERE rowid=?`).get(src.message_rowid) as any).v;
    db.query(`UPDATE messages SET ${column}=? WHERE rowid=?`).run(column==='thread_id'||column==='is_bot_message'?9:'edited',src.message_rowid);
    expect(()=>publish(db,alice,request)).toThrow(ChatAccessDenied); db.query(`UPDATE messages SET ${column}=? WHERE rowid=?`).run(old,src.message_rowid);
  }
  expect(ledger()).toBe(snapshot); const first=publish(db,alice,request);expect(first.created).toBe(true);
  db.query('DELETE FROM messages WHERE rowid=?').run(src.message_rowid);expect(publish(db,alice,request)).toEqual({...first,created:false});
  expect(()=>publish(db,alice,{...request,request_id:randomUUID()})).toThrow(ChatAccessDenied);
});

test('exact input, source and UTF-8 bounds never widen an excerpt or leak optional payloads',()=>{
  const db=getDb(),request=input(),before=ledger();
  for(const patch of [{confirm:false},{text:'generated summary'},{text:''},{text:' '},{text:'\0'},{text:'\ud800'},{text:'a'.repeat(16385)},
    {request_id:'bad'},{source_hash:'F'.repeat(64)},{source_hash:'0'.repeat(64)},{owner_user_id:bob.userId},{attachment:1}])expect(()=>publish(db,alice,{...request,...patch} as any)).toThrow(ChatAccessDenied);
  const {confirm,...missing}=request; expect(()=>publish(db,alice,missing as any)).toThrow(ChatAccessDenied);
  for(const bad of [null,[],{},'text'])expect(()=>preview(db,alice,bad as any)).toThrow(ChatAccessDenied);
  expect(ledger()).toBe(before);
  for(const text of ['', 'a'.repeat(102401),'bad\0text'])expect(()=>preview(db,alice,message(alice,text))).toThrow(ChatAccessDenied);
  const max='é'.repeat(8192),maxSource=message(alice,max+'x'.repeat(102400-16384));
  expect(preview(db,alice,maxSource).text.length).toBe(94208);expect(publish(db,alice,input(maxSource,max)).created).toBe(true);
  expect(()=>publish(db,alice,input(message(alice,max+'é'),max+'é'))).toThrow(ChatAccessDenied);
});

test('mode, execution context and live login are independently required on every entry',()=>{
  const db=getDb(),request=input(),id=publish(db,alice,request).publication_id;
  const calls=[()=>preview(db,alice,{chat_jid:request.chat_jid,message_id:request.message_id,message_rowid:request.message_rowid}),
    ()=>publish(db,alice,request),()=>inspect(db,alice,id),()=>withdraw(db,alice,id,{confirm:true}),()=>shared(db,alice)];
  const before=ledger();
  for(const name of ['single-user','isolated-containers','invalid']){mode(name);for(const call of calls)expect(call).toThrow();} mode('family-shared');
  writeFileSync(config,'{bad');for(const call of calls)expect(call).toThrow();mode('family-shared');
  for(const kind of ['interactive','scheduled','dream','delegate','side-prompt','followup'] as const){
    const identity={mode:'family-shared',provenance:{kind}} as ExecutionIdentity;
    withExecutionIdentity(identity,()=>{for(const call of calls)expect(call).toThrow(ChatAccessDenied);});
  }
  db.query('DELETE FROM web_sessions WHERE session_id=?').run(alice.authentication.sessionId!);for(const call of calls)expect(call).toThrow(ChatAccessDenied);
  expect(ledger()).toBe(before);alice=actor(alice.userId);expect(shared(db,alice).items).toHaveLength(1);
  const renewed=alice;alice={...alice,role:'admin'};for(const call of calls)expect(call).toThrow(ChatAccessDenied);alice=renewed;
  db.query('UPDATE users SET enabled=0 WHERE id=?').run(alice.userId);for(const call of calls)expect(call).toThrow(ChatAccessDenied);
  expect(shared(db,bob).items).toHaveLength(1);
});

test('mutation requires recent actual factor login; read remains available with older valid login',()=>{
  const db=getDb(),request=input(),id=publish(db,alice,request).publication_id;
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600000).toISOString(),alice.authentication.sessionId!);
  expect(shared(db,alice).items).toHaveLength(1);expect(inspect(db,alice,id).withdrawn).toBe(false);
  expect(()=>publish(db,alice,request)).toThrow(ChatAccessDenied);expect(()=>withdraw(db,alice,id,{confirm:true})).toThrow(ChatAccessDenied);
  alice=actor(alice.userId);db.query("UPDATE web_sessions SET auth_method='password' WHERE session_id=?").run(alice.authentication.sessionId!);
  expect(()=>publish(db,alice,request)).toThrow(ChatAccessDenied);alice=actor(alice.userId);
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()+60000).toISOString(),alice.authentication.sessionId!);
  expect(()=>publish(db,alice,request)).toThrow(ChatAccessDenied);
});

test('retry retains original labels/login, cannot change payload and cannot resurrect withdrawn copy',()=>{
  const db=getDb(),request=input(),first=publish(db,alice,request),login=alice.authentication.sessionId;
  db.query("UPDATE users SET username='renamed',display_name='New display' WHERE id=?").run(alice.userId);alice=actor(alice.userId);
  expect(publish(db,alice,request)).toEqual({...first,created:false});expect(shared(db,bob).items[0]?.publisher.username).toBe('alice');
  expect(db.query('SELECT login_session_id FROM family_memory_publications').get()).toEqual({login_session_id:login});
  expect(()=>publish(db,alice,{...request,text:'fact.'})).toThrow(ChatAccessDenied);
  db.query("UPDATE messages SET content='changed source' WHERE rowid=?").run(request.message_rowid);
  expect(publish(db,alice,request)).toEqual({...first,created:false});expect(shared(db,bob).items[0]?.text).toBe(request.text);
  expect(()=>publish(db,alice,{...request,request_id:randomUUID()})).toThrow(ChatAccessDenied);
  for(const who of [bob,admin])expect(()=>withdraw(db,who,first.publication_id,{confirm:true})).toThrow(ChatAccessDenied);
  expect(()=>withdraw(db,alice,first.publication_id,{confirm:false} as any)).toThrow(ChatAccessDenied);
  expect(()=>withdraw(db,alice,first.publication_id,{confirm:true,owner:alice.userId} as any)).toThrow(ChatAccessDenied);
  expect(withdraw(db,alice,first.publication_id,{confirm:true}).created).toBe(true);const snapshot=ledger();
  expect(withdraw(db,alice,first.publication_id,{confirm:true}).created).toBe(false);expect(ledger()).toBe(snapshot);
  expect(shared(db,bob).items).toEqual([]);expect(()=>publish(db,alice,request)).toThrow(ChatAccessDenied);expect(inspect(db,alice,first.publication_id).withdrawn).toBe(true);
  for(const table of ['family_memory_publications','family_memory_withdrawals']){
    expect(()=>db.exec(`DELETE FROM ${table}`)).toThrow('cannot be deleted');expect(()=>db.exec(`UPDATE ${table} SET owner_user_id='default'`)).toThrow('immutable');
  }
});

test('archive/delete never silently withdraws a shared copy, owner can withdraw without private source access',()=>{
  const db=getDb(),root=createOwnedRoot(db,alice,'memory'),src=message(alice,undefined,root.chat_jid),request=input(src),id=publish(db,alice,request).publication_id;
  archiveOwnedSession(db,alice,root.chat_jid);expect(publish(db,alice,request)).toEqual({publication_id:id,created:false});
  expect(()=>publish(db,alice,{...request,request_id:randomUUID()})).toThrow(ChatAccessDenied);
  expect(shared(db,bob).items).toHaveLength(1);expect(inspect(db,alice,id).source.chat_jid).toBe(root.chat_jid);
  db.query('DELETE FROM messages WHERE rowid=?').run(src.message_rowid);expect(withdraw(db,alice,id,{confirm:true}).created).toBe(true);expect(shared(db,bob).items).toHaveLength(0);
});

test('transaction failures roll back and remain retryable; shared-file content is never changed',()=>{
  const db=getDb(),request=input(),before=ledger(),legacy=join(ws.workspace,'MEMORY.md');writeFileSync(legacy,'unchanged');
  db.exec("CREATE TRIGGER fail_memory BEFORE INSERT ON family_memory_publications BEGIN SELECT RAISE(ABORT,'disk failure'); END");
  expect(()=>publish(db,alice,request)).toThrow('disk failure');expect(ledger()).toBe(before);db.exec('DROP TRIGGER fail_memory');
  const id=publish(db,alice,request).publication_id,after=ledger();
  db.exec("CREATE TRIGGER fail_withdraw BEFORE INSERT ON family_memory_withdrawals BEGIN SELECT RAISE(ABORT,'disk failure'); END");
  expect(()=>withdraw(db,alice,id,{confirm:true})).toThrow('disk failure');expect(ledger()).toBe(after);db.exec('DROP TRIGGER fail_withdraw');
  expect(withdraw(db,alice,id,{confirm:true}).created).toBe(true);expect(readFileSync(legacy,'utf8')).toBe('unchanged');
});

test('persisted copies survive reopen, concurrent connections retry one receipt and lock failures do not consume request',()=>{
  const request=input(),path=join(ws.workspace,'copy.sqlite');getDb().query('VACUUM INTO ?').run(path);const a=new Database(path),b=new Database(path);
  let id='';try {
    const first=publish(a,alice,request);id=first.publication_id;expect(publish(b,alice,request)).toEqual({...first,created:false});
    a.exec('BEGIN IMMEDIATE');expect(()=>publish(b,alice,{...request,request_id:randomUUID()})).toThrow();a.exec('ROLLBACK');
    expect(shared(b,bob).items).toHaveLength(1);expect(shared(getDb(),bob).items).toEqual([]);
  } finally {a.close();b.close();}
  const reopened=new Database(path);try{expect(publish(reopened,alice,request)).toEqual({publication_id:id,created:false});expect(withdraw(reopened,alice,id,{confirm:true}).created).toBe(true);}finally{reopened.close();}
});

test('shared window and retained per-owner capacity are bounded, deterministic and retries do not consume slots',()=>{
  const db=getDb(),request=input(),first=publish(db,alice,request),ids=[first.publication_id];
  for(let i=0;i<99;i++)ids.push(publish(db,alice,{...request,request_id:randomUUID()}).publication_id);
  expect(shared(db,bob).items).toHaveLength(20);
  expect(shared(db,bob).items.map(v=>v.publication_id)).toEqual((db.query('SELECT publication_id FROM family_memory_publications ORDER BY published_at DESC,publication_id DESC LIMIT 20').all() as any[]).map(v=>v.publication_id));
  expect(()=>publish(db,alice,{...request,request_id:randomUUID()})).toThrow(ChatAccessDenied);withdraw(db,alice,ids[1]!,{confirm:true});
  expect(publish(db,alice,request)).toEqual({...first,created:false});expect(()=>publish(db,alice,{...request,request_id:randomUUID()})).toThrow(ChatAccessDenied);
});

test('global retained bound applies across publishers and valid retries still acknowledge at capacity',()=>{
  const db=getDb(),request=input(),first=publish(db,alice,request);
  // Trusted fixture seeds other-owner rows to exercise the global guard independently of owner quota.
  const seed=db.query(`INSERT INTO family_memory_publications SELECT ?,?,? ,login_session_id,publisher_username,publisher_display_name,
    source_chat_jid,source_message_rowid,source_message_id,source_hash,text,text_hash,published_at FROM family_memory_publications WHERE publication_id=?`);
  db.transaction(()=>{for(let i=0;i<999;i++)seed.run(randomUUID(),bob.userId,randomUUID(),first.publication_id);})();
  expect(()=>publish(db,alice,{...request,request_id:randomUUID()})).toThrow(ChatAccessDenied);
  expect(publish(db,alice,request)).toEqual({...first,created:false});expect(shared(db,admin).items).toHaveLength(20);
  withdraw(db,alice,first.publication_id,{confirm:true});expect(()=>publish(db,alice,{...request,request_id:randomUUID()})).toThrow(ChatAccessDenied);
});

test('final authority check rolls back publication and withdrawal if login is revoked within transaction',()=>{
  const db=getDb(),request=input(),before=ledger();
  db.exec('CREATE TRIGGER revoke_on_memory AFTER INSERT ON family_memory_publications BEGIN DELETE FROM web_sessions WHERE session_id=NEW.login_session_id; END');
  expect(()=>publish(db,alice,request)).toThrow(ChatAccessDenied);expect(ledger()).toBe(before);db.exec('DROP TRIGGER revoke_on_memory');
  const first=publish(db,alice,request),after=ledger();
  db.exec('CREATE TRIGGER revoke_on_withdraw AFTER INSERT ON family_memory_withdrawals BEGIN DELETE FROM web_sessions WHERE session_id=NEW.login_session_id; END');
  expect(()=>withdraw(db,alice,first.publication_id,{confirm:true})).toThrow(ChatAccessDenied);expect(ledger()).toBe(after);db.exec('DROP TRIGGER revoke_on_withdraw');
  expect(withdraw(db,alice,first.publication_id,{confirm:true}).created).toBe(true);
});

test('corrupt copied text is denied by shared and owner readers and cannot be acknowledged on retry',()=>{
  const db=getDb(),request=input(),first=publish(db,alice,request);
  db.exec('DROP TRIGGER family_memory_publication_immutable');db.query("UPDATE family_memory_publications SET text='corrupt' WHERE publication_id=?").run(first.publication_id);
  expect(()=>shared(db,bob)).toThrow(ChatAccessDenied);expect(()=>inspect(db,alice,first.publication_id)).toThrow(ChatAccessDenied);
  expect(()=>publish(db,alice,request)).toThrow(ChatAccessDenied);
});
