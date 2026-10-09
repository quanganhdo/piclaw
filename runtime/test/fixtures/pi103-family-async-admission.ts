import assert from 'node:assert/strict';import Database from 'bun:sqlite';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';import{join}from'node:path';
import{initDatabase,getDb,closeDatabase}from'../../src/db/connection.js';
import{createWebSession,revokeUserWebSessions}from'../../src/db/web-sessions.js';import{getUser}from'../../src/db/users.js';
import{provisionFamilyAccount,updateManagedAccount}from'../../src/db/account-administration.js';import{provisionUserHome}from'../../src/db/session-ownership.js';
import{resolveRequestPrincipal}from'../../src/channels/web/auth/principal.js';import{createOwnedRoot}from'../../src/db/owned-session-lifecycle.js';
import{admitFamilyHttpMessage}from'../../src/channels/web/messaging/family-message-authority.js';
import{assertPathWithinTestFilesystemIsolation}from'../../scripts/test-filesystem-isolation.js';
const mode=process.argv[2];assert(['release','abort','revoke','home','target','reopen','replace','config','payload','rollback'].includes(mode));
const workspace=process.env.PICLAW_WORKSPACE!,store=process.env.PICLAW_STORE!;assertPathWithinTestFilesystemIsolation(workspace,process.env,{allowRoot:false});assert.equal(process.env.PICLAW_DB_IN_MEMORY,'0');
mkdirSync(join(workspace,'.piclaw'),{recursive:true});writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));
initDatabase();const db=getDb();function actor(id:string){const login=createWebSession('synthetic-async-'+id,id,3600,'passkey');return resolveRequestPrincipal(new Request('https://synthetic.invalid',{headers:{cookie:'piclaw_session=synthetic'}}),{mode:'family-shared',authEnabled:true},{getSession:()=>login,getUser:()=>getUser(db,id),getLocalDisplayName:()=> 'Synthetic'})!}
const admin=actor('default'),user=provisionFamilyAccount(db,admin,{username:'async-owner',displayName:'Synthetic'});db.query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key)VALUES(?,'localhost','synthetic','synthetic')").run(user.id);updateManagedAccount(db,admin,user.id,{enabled:true},{totp:false,passkey:true,rpId:'localhost'});const owner=actor(user.id),root=createOwnedRoot(db,owner,'async-target'),other=createOwnedRoot(db,owner,'new-home');
const request={content:'Synthetic unchanged payload',requestId:'async-request',chatJid:mode==='home'?undefined:root.chat_jid};const abort=new AbortController(),file=join(store,'messages.db');let blocker:Database|undefined;
try{
 if(mode==='rollback')db.exec(`CREATE TRIGGER deny_async_authority BEFORE INSERT ON message_execution_authorities BEGIN SELECT RAISE(ABORT,'synthetic failed admission'); END;`);
 blocker=new Database(file);blocker.exec('BEGIN IMMEDIATE');
 const waiting=admitFamilyHttpMessage(owner,request,abort.signal).then(value=>({accepted:true,value}),error=>({accepted:false,error}));
 await Bun.sleep(10);assert.deepEqual(db.query('PRAGMA busy_timeout').get(),{timeout:5000});assert.equal((db.query('SELECT count(*)AS n FROM messages').get()as any).n,0);
 if(mode==='abort')abort.abort(Error('Synthetic cancelled'));
 if(mode==='payload')request.content='Mutation must not be admitted';
 blocker.exec('ROLLBACK');blocker.close();blocker=undefined;
 if(mode==='revoke')revokeUserWebSessions(owner.userId);
 if(mode==='home')provisionUserHome(db,owner.userId,other.chat_jid);
 if(mode==='target')db.query('UPDATE chat_branches SET branch_id=? WHERE chat_jid=?').run('synthetic-replaced-incarnation',root.chat_jid);
 if(mode==='config')writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));
 if(mode==='reopen'){closeDatabase();initDatabase();}
 if(mode==='replace'){renameSync(file,file+'.preserved');const replacement=new Database(file);replacement.close();}
 const outcome=await waiting;const read=mode==='reopen'?getDb():db;
 assert.equal(outcome.accepted,['release','payload'].includes(mode));
 const count=(table:string)=>Number((read.query(`SELECT count(*)AS n FROM ${table}`).get()as any).n);
 if(outcome.accepted){assert.equal(count('messages'),1);assert.equal(count('message_execution_authorities'),1);assert.equal(count('family_turn_queue'),1);assert.equal((read.query('SELECT content FROM messages').get()as any).content,'Synthetic unchanged payload');const replay=await admitFamilyHttpMessage(owner,{...request,content:'Synthetic unchanged payload'},new AbortController().signal);assert.equal(replay.created,false);assert.equal(count('messages'),1);}else{assert.equal(count('messages'),0);assert.equal(count('message_execution_authorities'),0);assert.equal(count('family_turn_queue'),0);}
 assert.deepEqual(read.query('PRAGMA busy_timeout').get(),{timeout:5000});console.log(JSON.stringify({mode,accepted:outcome.accepted,noUnexpectedRows:true,timeoutRestored:true,scope:'owned disk family async admission, held writer, no live/model/provider/HTTP; mutation/reopen/file/config guards and rollback'}));
}finally{blocker?.close();closeDatabase()}
