import { beforeEach, expect, test } from "bun:test";
import { initDatabase, getDb } from "../../../../src/db/connection.js";
import { createUser } from "../../../../src/db/users.js";
import { getWebSession } from "../../../../src/db/web-sessions.js";
import { handleAuthVerifyRequest, type TotpAuthContext } from "../../../../src/channels/web/auth/totp-auth.js";
import { TotpFailureTracker } from "../../../../src/channels/web/auth/totp-failure-tracker.js";

beforeEach(()=>{initDatabase();getDb().exec("DELETE FROM user_auth_attempts");});

function context(): TotpAuthContext {return {accessMode:"family-shared",isAuthEnabled:()=>true,isTotpEnabled:()=>true,json:(body,status=200)=>Response.json(body,{status}),getClientKey:()=>"shared-ip",logAuthEvent:()=>{},buildSessionCookie:token=>`piclaw_session=${token}`,failureTracker:new TotpFailureTracker()};}
function request(username="alice",code="123456",origin="https://example.com"){return new Request("https://example.com/auth/verify",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({username,code})});}

test("multi-user TOTP refuses a missing account verifier instead of legacy fallback",async()=>{
 const response=await handleAuthVerifyRequest(request(),context());
 expect(response.status).toBe(503);expect(response.headers.get("set-cookie")).toBeNull();
});

test("TOTP cookie uses selected verified owner with final enabled-account check",async()=>{
 initDatabase();getDb().exec("DELETE FROM user_totp_factors; DELETE FROM user_totp_enrolments; DELETE FROM web_sessions; DELETE FROM users WHERE username='alice'");
 const user=createUser(getDb(),{username:"alice",displayName:"Alice"});
 getDb().query("UPDATE users SET enabled=1,home_chat_jid='web:alice' WHERE id=?").run(user.id);
 getDb().query("INSERT INTO user_totp_factors(user_id,ciphertext,salt,nonce,revision,last_used_step,created_at) VALUES (?,X'00',X'00',X'00','revision',1,'now')").run(user.id);
 const proof={userId:user.id,factorRevision:"revision",step:1};
 const ctx=context();ctx.verifyUserTotp=async(username,code)=>username==="alice"&&code==="123456"?proof:null;
 const response=await handleAuthVerifyRequest(request("ALICE"),ctx);
 expect(response.status).toBe(200);
 expect(getWebSession(response.headers.get("set-cookie")!.split("=")[1])?.user_id).toBe(user.id);
 ctx.verifyUserTotp=async()=>{getDb().query("UPDATE users SET enabled=0 WHERE id=?").run(user.id);return proof;};
 const denied=await handleAuthVerifyRequest(request(),ctx);expect(denied.status).toBe(401);expect(denied.headers.get("set-cookie")).toBeNull();
});

test("account and IP lockout prevent repeated verifier work without exposing account status",async()=>{
 const ctx=context();let calls=0;ctx.verifyUserTotp=async()=>{calls++;return null;};
 for(let i=0;i<5;i++)await handleAuthVerifyRequest(request(),ctx);
 expect((await handleAuthVerifyRequest(request(),ctx)).status).toBe(429);expect(calls).toBe(5);
 const otherIp={...ctx,getClientKey:()=>"other-ip"};
 expect((await handleAuthVerifyRequest(request(),otherIp)).status).toBe(429);expect(calls).toBe(5);
});

test("concurrent attempts reserve the account budget before verifier awaits",async()=>{
 const ctx=context();let calls=0;
 let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
 ctx.verifyUserTotp=async()=>{calls++;await gate;return null;};
 const pending=Array.from({length:12},()=>handleAuthVerifyRequest(request(),ctx));
 await Bun.sleep(20);expect(calls).toBe(5);release();
 const replies=await Promise.all(pending);expect(replies.filter(r=>r.status===429).length).toBeGreaterThanOrEqual(7);
});

test("single-user context cannot accidentally install a per-user verifier",async()=>{
 const ctx=context();ctx.accessMode="single-user";ctx.verifyUserTotp=async()=>null;
 expect((await handleAuthVerifyRequest(request(),ctx)).status).toBe(503);
});

test("strict inputs and foreign origin fail before the verifier",async()=>{
 const ctx=context();let calls=0;ctx.verifyUserTotp=async()=>{calls++;return null;};
 expect((await handleAuthVerifyRequest(request("alice","1234567"),ctx)).status).toBe(401);
 expect((await handleAuthVerifyRequest(request("bad name"),ctx)).status).toBe(401);
 expect((await handleAuthVerifyRequest(request("alice","123456","https://foreign.example"),ctx)).status).toBe(403);
 expect(calls).toBe(0);
});
