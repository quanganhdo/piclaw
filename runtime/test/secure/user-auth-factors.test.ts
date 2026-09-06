import Database from "bun:sqlite";
import { beforeEach, afterEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { initializeUserSchema, createUser } from "../../src/db/users.js";
import { initializeAuthFactorSchema } from "../../src/db/auth-factors-schema.js";
import { UserAuthFactors, reserveUserAuthAttempt } from "../../src/secure/user-auth-factors.js";
import { matchTotpStep } from "../../src/channels/web/auth/auth.js";

let db: Database, service: UserAuthFactors, userId: string, clock: number;
const key = "test-only-auth-master";
function code(secret: string, time = clock): string {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits=0, buffer=0; const bytes:number[]=[];
  for(const c of secret){buffer=(buffer<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((buffer>>bits)&255);}}
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30_000)));
  const h=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();const o=h[h.length-1]&15;
  return (((h[o]&127)<<24|(h[o+1]&255)<<16|(h[o+2]&255)<<8|(h[o+3]&255))%1_000_000).toString().padStart(6,"0");
}
beforeEach(()=>{db=new Database(":memory:");initializeUserSchema(db);initializeAuthFactorSchema(db);userId=createUser(db,{username:"alice",displayName:"Alice"}).id;clock=1_800_000_000_000;service=new UserAuthFactors(db,()=>key,()=>clock);});
afterEach(()=>db.close());
function enable(id=userId){db.query("UPDATE users SET enabled=1,home_chat_jid='web:home' WHERE id=?").run(id);}

test("pending enrolment stores only ciphertext and token hash outside generic keychain",async()=>{
 const issued=await service.beginEnrolment(userId);
 const row=db.query("SELECT * FROM user_totp_enrolments").get() as any;
 expect(row.token_hash).not.toBe(issued.token);
 expect(row.token_hash).toHaveLength(64);
 expect(Buffer.from(row.ciphertext).toString()).not.toContain(issued.secret);
 expect(db.query("SELECT name FROM sqlite_master WHERE name='keychain_entries'").get()).toBeNull();
 expect(db.query("SELECT * FROM user_totp_factors").all()).toHaveLength(0);
 expect(await service.verifyLogin("alice",code(issued.secret))).toBeNull();
 expect(await service.confirmEnrolment(userId,issued.token,code(issued.secret))).toBe(true);
 expect(db.query("SELECT enabled FROM users WHERE id=?").get(userId)).toEqual({enabled:0});
 expect(await service.confirmEnrolment(userId,issued.token,code(issued.secret))).toBe(false);
});

test("enrolment is user-bound, one-time and expires",async()=>{
 const other=createUser(db,{username:"bob",displayName:"Bob"}).id;
 const issued=await service.beginEnrolment(userId);
 expect(await service.confirmEnrolment(other,issued.token,code(issued.secret))).toBe(false);
 expect(await service.confirmEnrolment(userId,issued.token,"bad-code")).toBe(false);
 clock=issued.expiresAt;
 expect(await service.confirmEnrolment(userId,issued.token,code(issued.secret))).toBe(false);
});

test("successful login consumes its time step once across concurrent verifications",async()=>{
 const issued=await service.beginEnrolment(userId);
 await service.confirmEnrolment(userId,issued.token,code(issued.secret));enable();
 expect(await service.verifyLogin("alice",code(issued.secret))).toBeNull(); // Confirmation consumed this step.
 clock+=30_000;
 const result=await Promise.all([service.verifyLogin("alice",code(issued.secret)),service.verifyLogin("ALICE",code(issued.secret))]);
 expect(result.filter(v=>v?.userId===userId)).toHaveLength(1);
 expect(result.filter(v=>v===null)).toHaveLength(1);
});

test("disabled users and unknown accounts cannot authenticate",async()=>{
 const issued=await service.beginEnrolment(userId);await service.confirmEnrolment(userId,issued.token,code(issued.secret));clock+=30_000;
 expect(await service.verifyLogin("alice",code(issued.secret))).toBeNull();
 expect(await service.verifyLogin("missing",code(issued.secret))).toBeNull();
 enable();expect((await service.verifyLogin("alice",code(issued.secret)))?.userId).toBe(userId);
});

test("repeated confirmation is atomic and an existing factor cannot be overwritten",async()=>{
 const issued=await service.beginEnrolment(userId);
 const results=await Promise.all([service.confirmEnrolment(userId,issued.token,code(issued.secret)),service.confirmEnrolment(userId,issued.token,code(issued.secret))]);
 expect(results.filter(Boolean)).toHaveLength(1);
 await expect(service.beginEnrolment(userId)).rejects.toThrow("explicit authenticated reset");
});

test("wrong key and cross-user ciphertext substitution fail authentication",async()=>{
 const issued=await service.beginEnrolment(userId);await service.confirmEnrolment(userId,issued.token,code(issued.secret));clock+=30_000;enable();
 await expect(new UserAuthFactors(db,()=>"wrong-key",()=>clock).verifyLogin("alice",code(issued.secret))).rejects.toThrow();
 const other=createUser(db,{username:"bob",displayName:"Bob"}).id;enable(other);
 db.query("UPDATE user_totp_factors SET user_id=? WHERE user_id=?").run(other,userId);
 await expect(service.verifyLogin("bob",code(issued.secret))).rejects.toThrow();
});

test("enrolment confirmation reserves at most five guesses and removes expired seeds",async()=>{
 const issued=await service.beginEnrolment(userId);
 await Promise.all(Array.from({length:8},()=>service.confirmEnrolment(userId,issued.token,"bad-code")));
 expect(db.query("SELECT attempts FROM user_totp_enrolments").get()).toEqual({attempts:5});
 expect(await service.confirmEnrolment(userId,issued.token,code(issued.secret))).toBe(false);
 clock=issued.expiresAt;
 expect(await service.confirmEnrolment(userId,issued.token,code(issued.secret))).toBe(false);
 expect(db.query("SELECT * FROM user_totp_enrolments").all()).toHaveLength(0);
});

test("persistent login budget accounts for household users and expires",()=>{
 for(let i=0;i<5;i++)expect(reserveUserAuthAttempt(db,"alice","household",clock)).toBe(true);
 expect(reserveUserAuthAttempt(db,"alice","other-ip",clock)).toBe(false);
 expect(reserveUserAuthAttempt(db,"bob","household",clock)).toBe(true);
 clock+=300_000;
 expect(reserveUserAuthAttempt(db,"alice","household",clock)).toBe(true);
});

test("strict matcher supports bounded skew and rejects truncated or malformed codes",()=>{
 const seed="JBSWY3DPEHPK3PXP";const correct=code(seed);
 expect(matchTotpStep(seed,correct,clock)).toBe(Math.floor(clock/30_000));
 expect(matchTotpStep(seed,correct,clock+30_000)).toBe(Math.floor(clock/30_000));
 for(const bad of [`${correct}1`,`${correct.slice(0,3)}-${correct.slice(3)}`,"00000","abc",` ${correct}`])expect(matchTotpStep(seed,bad,clock)).toBeNull();
 expect(matchTotpStep(seed,correct,clock,3)).toBeNull();
 expect(matchTotpStep(seed,correct,NaN)).toBeNull();
});
