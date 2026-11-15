import { beforeEach, afterEach, expect, test } from "bun:test";
import "../helpers.js";
import { closeDatabase, initDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { pruneExpiredAuthState } from "../../src/db/auth-maintenance.js";
import { startAuthMaintenance } from "../../src/runtime/auth-maintenance.js";
beforeEach(()=>{closeDatabase();initDatabase();});afterEach(()=>closeDatabase());
test("single-user cleanup removes expired transient sessions only and retains historical tables",()=>{
 const db=getDb(),now=Date.now();createWebSession("valid","default",3600,"totp");const dead=createWebSession("dead","default",3600,"totp");
 db.query("UPDATE web_sessions SET expires_at='bad' WHERE session_id=?").run(dead.session_id!);
 db.exec("INSERT INTO webauthn_enrollments(token,user_id,created_at,expires_at) VALUES ('bad','default','now','invalid'); CREATE TABLE user_auth_invitations(value TEXT); INSERT INTO user_auth_invitations VALUES ('historical evidence')");
 expect(pruneExpiredAuthState(db,now)).toEqual({sessions:1,legacyEnrolments:1});
 expect(db.query("SELECT COUNT(*) n FROM users").get()).toEqual({n:1});expect(db.query("SELECT COUNT(*) n FROM web_sessions").get()).toEqual({n:1});
 expect(db.query("SELECT value FROM user_auth_invitations").get()).toEqual({value:"historical evidence"});
 expect(pruneExpiredAuthState(db,now)).toEqual({sessions:0,legacyEnrolments:0});expect(()=>pruneExpiredAuthState(db,NaN)).toThrow();
});
test("cleanup starts once, prunes immediately and stops idempotently",()=>{
 startAuthMaintenance()();const dead=createWebSession("expired","default",3600,"totp");getDb().query("UPDATE web_sessions SET expires_at='invalid' WHERE session_id=?").run(dead.session_id!);
 const stop=startAuthMaintenance();expect(startAuthMaintenance()).toBe(stop);expect(getDb().query("SELECT COUNT(*) n FROM web_sessions").get()).toEqual({n:0});stop();stop();const next=startAuthMaintenance();expect(next).not.toBe(stop);next();
});
