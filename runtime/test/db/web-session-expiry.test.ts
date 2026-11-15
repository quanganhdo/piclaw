import { beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { initDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession, getWebSession } from "../../src/db/web-sessions.js";
import { pruneExpiredAuthState } from "../../src/db/auth-maintenance.js";

beforeEach(() => { initDatabase(); getDb().run("DELETE FROM web_sessions"); getDb().run("DELETE FROM webauthn_enrollments"); });
for(const legacy of [false,true])for(const expiry of ["2000-01-01T00:00:00.000Z","invalid"]){
  test(`read-only denial then maintenance: ${legacy?"legacy":"hashed"} ${expiry}`,()=>{
    const db=getDb();createWebSession("expired-fixture","default",3600,"totp");
    db.query("UPDATE web_sessions SET expires_at=?, token=?").run(expiry,legacy?"expired-fixture":createHash("sha256").update("expired-fixture").digest("hex"));
    db.query("INSERT INTO webauthn_enrollments(token,user_id,created_at,expires_at) VALUES ('expired','default',?,?), ('valid','default',?,?)")
      .run(new Date().toISOString(),expiry,new Date().toISOString(),new Date(Date.now()+60000).toISOString());
    const before=db.query("SELECT * FROM web_sessions").all();
    const enrolmentsBefore=db.query("SELECT * FROM webauthn_enrollments ORDER BY token").all();
    db.run("CREATE TEMP TRIGGER forbid_auth_update BEFORE UPDATE ON web_sessions BEGIN SELECT RAISE(ABORT,'request wrote'); END");
    db.run("CREATE TEMP TRIGGER forbid_auth_delete BEFORE DELETE ON web_sessions BEGIN SELECT RAISE(ABORT,'request wrote'); END");
    try {
      expect(getWebSession("expired-fixture")).toBeNull();expect(getWebSession("expired-fixture")).toBeNull();
      expect(db.query("SELECT * FROM web_sessions").all()).toEqual(before);
      expect(db.query("SELECT * FROM webauthn_enrollments ORDER BY token").all()).toEqual(enrolmentsBefore);
    }finally{db.run("DROP TRIGGER forbid_auth_update");db.run("DROP TRIGGER forbid_auth_delete");}
    expect(pruneExpiredAuthState(db)).toEqual({sessions:1,legacyEnrolments:1});
    expect(db.query("SELECT count(*) AS n FROM web_sessions").get()).toEqual({n:0});
    expect(db.query("SELECT token FROM webauthn_enrollments").all()).toEqual([{token:'valid'}]);
  });
}
test("maintenance preserves retired per-account registration data",()=>{
  const db=new Database(':memory:');
  try {
    db.exec(`CREATE TABLE web_sessions(expires_at TEXT);
      CREATE TABLE webauthn_enrollments(expires_at TEXT);
      CREATE TABLE user_totp_registrations(value TEXT);
      CREATE TABLE user_passkey_registrations(value TEXT);
      INSERT INTO user_totp_registrations VALUES ('preserved-totp');
      INSERT INTO user_passkey_registrations VALUES ('preserved-passkey');`);
    const before=db.serialize();
    expect(pruneExpiredAuthState(db)).toEqual({sessions:0,legacyEnrolments:0});
    expect(db.serialize()).toEqual(before);
  } finally { db.close(); }
});
test("valid legacy migration failures cannot authenticate",()=>{
  const db=getDb();createWebSession("valid-legacy","default",3600,"totp");db.run("UPDATE web_sessions SET token='valid-legacy'");
  db.run("CREATE TEMP TRIGGER fail_legacy BEFORE UPDATE ON web_sessions BEGIN SELECT RAISE(ABORT,'migration failed'); END");
  try{expect(()=>getWebSession("valid-legacy")).toThrow("migration failed");}finally{db.run("DROP TRIGGER fail_legacy");}
  expect(getWebSession("valid-legacy")?.user_id).toBe("default");
});
