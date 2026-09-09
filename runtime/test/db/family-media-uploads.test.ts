import { afterEach, beforeEach, expect, test } from "bun:test";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { createMediaInDatabase } from "../../src/db/media.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { getUser } from "../../src/db/users.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import { claimFamilyMediaUpload, consumeFamilyMediaUploads, pruneExpiredFamilyMediaUploads } from "../../src/db/family-media-uploads.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";

let alice:AuthenticatedPrincipal,bob:AuthenticatedPrincipal;
function actor(id:string){const login=createWebSession(`token-${id}-${crypto.randomUUID()}`,id,3600,"passkey");return resolveRequestPrincipal(new Request("https://family.local",{headers:{cookie:"piclaw_session=fixture"}}),{mode:"family-shared",authEnabled:true},{getSession:()=>login,getUser:()=>getUser(getDb(),id),getLocalDisplayName:()=>"unused"})!;}
function media(){return createMediaInDatabase(getDb(),"file.txt","text/plain",new TextEncoder().encode("body"),null,{size:4});}
beforeEach(()=>{closeDatabase();initDatabase();const admin=actor("default");for(const name of ["alice","bob"]){const user=provisionFamilyAccount(getDb(),admin,{username:name,displayName:name}).id;getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user,name);updateManagedAccount(getDb(),admin,user,{enabled:true},{totp:false,passkey:true,rpId:"family.local"});if(name==="alice")alice=actor(user);else bob=actor(user);}});afterEach(()=>closeDatabase());

test("pending family uploads are immutable owner/login claims consumed once",()=>{
  const id=media();claimFamilyMediaUpload(getDb(),alice,id);
  expect(()=>consumeFamilyMediaUploads(getDb(),bob,[id])).toThrow();
  expect(()=>consumeFamilyMediaUploads(getDb(),alice,[id,id])).toThrow();
  expect(getDb().query("SELECT owner_user_id,login_session_id FROM family_media_uploads WHERE media_id=?").get(id)).toEqual({owner_user_id:alice.userId,login_session_id:alice.authentication.sessionId});
  consumeFamilyMediaUploads(getDb(),alice,[id]);
  expect(getDb().query("SELECT 1 FROM family_media_uploads WHERE media_id=?").get(id)).toBeNull();
  expect(()=>consumeFamilyMediaUploads(getDb(),alice,[id])).toThrow();
});

test("claim and consume roll back with their surrounding transactions",()=>{
  const claimed=media();expect(()=>getDb().transaction(()=>{claimFamilyMediaUpload(getDb(),alice,claimed);throw new Error("rollback");}).immediate()).toThrow("rollback");
  expect(getDb().query("SELECT 1 FROM family_media_uploads WHERE media_id=?").get(claimed)).toBeNull();
  const consumed=media();claimFamilyMediaUpload(getDb(),alice,consumed);
  expect(()=>getDb().transaction(()=>{consumeFamilyMediaUploads(getDb(),alice,[consumed]);throw new Error("rollback");}).immediate()).toThrow("rollback");
  expect(getDb().query("SELECT 1 FROM family_media_uploads WHERE media_id=?").get(consumed)).not.toBeNull();
});

test("expired unlinked uploads prune without deleting attached or another fresh blob",()=>{
  const old=media(),attached=media(),fresh=media();claimFamilyMediaUpload(getDb(),alice,old);claimFamilyMediaUpload(getDb(),alice,attached);claimFamilyMediaUpload(getDb(),bob,fresh,new Date(Date.now()+2*60*60*1000).toISOString());
  getDb().query("INSERT INTO messages(id,chat_jid,sender,sender_name,content,timestamp) VALUES ('m','web:x','x','x','x',?)").run(new Date().toISOString());
  const row=(getDb().query("SELECT rowid FROM messages WHERE id='m'").get() as {rowid:number}).rowid;getDb().query("INSERT INTO message_media VALUES (?,?)").run(row,attached);
  expect(pruneExpiredFamilyMediaUploads(getDb(),Date.now()+90*60*1000)).toBe(1);
  expect(getDb().query("SELECT 1 FROM media WHERE id=?").get(old)).toBeNull();expect(getDb().query("SELECT 1 FROM media WHERE id=?").get(attached)).not.toBeNull();expect(getDb().query("SELECT 1 FROM media WHERE id=?").get(fresh)).not.toBeNull();
});
