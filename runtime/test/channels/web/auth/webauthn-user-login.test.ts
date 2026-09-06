import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, expect, test } from "bun:test";
import { getDb, initDatabase } from "../../../../src/db/connection.js";
import { createUser } from "../../../../src/db/users.js";
import { storeWebauthnCredential, createWebauthnEnrollment } from "../../../../src/db/webauthn.js";
import { getWebSession } from "../../../../src/db/web-sessions.js";
import { handleWebauthnLoginStart, handleWebauthnLoginFinish, handleWebauthnRegisterStart, type WebauthnAuthContext } from "../../../../src/channels/web/auth/webauthn-auth.js";
import { WebauthnChallengeTracker } from "../../../../src/channels/web/auth/webauthn-challenges.js";

let owner: string;
const keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const jwk=keys.publicKey.export({format:"jwk"});
// Deterministic CBOR encoding for EC2 P-256 COSE public key (kty/alg/crv/x/y).
const cose=Buffer.concat([Buffer.from([0xa5,0x01,0x02,0x03,0x26,0x20,0x01,0x21,0x58,0x20]),Buffer.from(jwk.x!,"base64url"),Buffer.from([0x22,0x58,0x20]),Buffer.from(jwk.y!,"base64url")]);
const credentialId=Buffer.from("test-credential").toString("base64url");
function context(): WebauthnAuthContext {return {accessMode:"family-shared",isPasskeyEnabled:()=>true,json:(body,status=200)=>Response.json(body,{status}),buildSessionCookie:token=>`piclaw_session=${token}`,logAuthEvent:()=>{},getClientKey:()=>"household-ip",challenges:new WebauthnChallengeTracker()};}
function credential(challenge:string,user=owner,origin="https://example.com"){
 const clientData=Buffer.from(JSON.stringify({type:"webauthn.get",challenge,origin}));
 const count=Buffer.alloc(4);count.writeUInt32BE(1);
 const authData=Buffer.concat([createHash("sha256").update("example.com").digest(),Buffer.from([5]),count]);
 const signature=sign("sha256",Buffer.concat([authData,createHash("sha256").update(clientData).digest()]),keys.privateKey);
 return {id:credentialId,rawId:credentialId,type:"public-key",clientExtensionResults:{},response:{clientDataJSON:clientData.toString("base64url"),authenticatorData:authData.toString("base64url"),signature:signature.toString("base64url"),userHandle:Buffer.from(user).toString("base64url")}};
}
function finish(body:unknown){return new Request("https://example.com/auth/webauthn/login/finish",{method:"POST",headers:{"content-type":"application/json",origin:"https://example.com"},body:JSON.stringify(body)});}
beforeEach(()=>{
 initDatabase();getDb().exec("DELETE FROM webauthn_credentials; DELETE FROM webauthn_enrollments; DELETE FROM web_sessions; DELETE FROM users WHERE id!='default'");
 owner=createUser(getDb(),{username:"alice",displayName:"Alice"}).id;
 getDb().query("UPDATE users SET enabled=1,home_chat_jid='web:alice' WHERE id=?").run(owner);
 storeWebauthnCredential({user_id:owner,rp_id:"example.com",credential_id:credentialId,public_key:cose.toString("base64url"),sign_count:0,transports:null});
});

test("real signed discoverable login issues the credential owner's cookie",async()=>{
 const ctx=context();
 const start=await (await handleWebauthnLoginStart(new Request("https://example.com/auth/webauthn/login/start"),ctx)).json();
 expect(start.options.userVerification).toBe("required");
 const response=await handleWebauthnLoginFinish(finish({token:start.token,credential:credential(start.options.challenge)}),ctx);
 expect(response.status).toBe(200);
 const token=response.headers.get("set-cookie")!.split("=")[1];
 expect(getWebSession(token)?.user_id).toBe(owner);
 expect(await (await handleWebauthnLoginFinish(finish({token:start.token,credential:credential(start.options.challenge)}),ctx)).json()).toEqual({error:"Login expired"});
});

test("signed assertion with foreign userHandle or wrong origin never issues a cookie",async()=>{
 for(const bad of ["handle","origin"]){
  const ctx=context();const start=await (await handleWebauthnLoginStart(new Request("https://example.com/auth/webauthn/login/start"),ctx)).json();
  const assertion=credential(start.options.challenge,bad==="handle"?"other-user":owner,bad==="origin"?"https://evil.example":"https://example.com");
  const response=await handleWebauthnLoginFinish(finish({token:start.token,credential:assertion}),ctx);
  expect(response.status).toBe(401);expect(response.headers.get("set-cookie")).toBeNull();
 }
});

test("disabled account cannot authenticate with a valid passkey",async()=>{
 const ctx=context();const start=await (await handleWebauthnLoginStart(new Request("https://example.com/auth/webauthn/login/start"),ctx)).json();
 getDb().query("UPDATE users SET enabled=0 WHERE id=?").run(owner);
 const response=await handleWebauthnLoginFinish(finish({token:start.token,credential:credential(start.options.challenge)}),ctx);
 expect(response.status).toBe(401);expect(response.headers.get("set-cookie")).toBeNull();
});

test("account-bound registration requires authorisation and uses user's identity",async()=>{
 const enrol=createWebauthnEnrollment(owner);
 const ctx=context();
 const req=()=>new Request("https://example.com/auth/webauthn/register/start",{method:"POST",headers:{origin:"https://example.com","content-type":"application/json"},body:JSON.stringify({token:enrol.token})});
 expect((await handleWebauthnRegisterStart(req(),ctx)).status).toBe(403);
 ctx.authoriseEnrolment=(_req,id)=>id===owner;
 const response=await handleWebauthnRegisterStart(req(),ctx);expect(response.status).toBe(200);
 const {options}=await response.json();
 expect(options.user.name).toBe("alice");expect(options.user.displayName).toBe("Alice");
 expect(Buffer.from(options.user.id,"base64url").toString()).toBe(owner);
 expect(options.authenticatorSelection.residentKey).toBe("required");
});
