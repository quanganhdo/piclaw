import { beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { initDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession, getWebSession } from "../../src/db/web-sessions.js";
import { pruneExpiredAuthState } from "../../src/db/auth-maintenance.js";

beforeEach(() => { initDatabase(); getDb().run("DELETE FROM web_sessions"); });
for(const legacy of [false,true])for(const expiry of ["2000-01-01T00:00:00.000Z","invalid"]){
  test(`read-only denial then maintenance: ${legacy?"legacy":"hashed"} ${expiry}`,()=>{
    const db=getDb(),login=createWebSession("expired-fixture","default",3600,"totp");
    db.query("UPDATE web_sessions SET expires_at=?, token=?").run(expiry,legacy?"expired-fixture":createHash("sha256").update("expired-fixture").digest("hex"));
    db.query("INSERT INTO user_totp_registrations(user_id,registration_id,session_id,origin,expires_at) VALUES ('default','fixture',?,'https://fixture.invalid',?)").run(login.session_id!,Date.now()+60000);
    db.query("INSERT INTO user_passkey_registrations(token_hash,user_id,session_id,rp_id,origin,challenge,expires_at) VALUES ('fixture','default',?,'fixture.invalid','https://fixture.invalid','synthetic',?)").run(login.session_id!,Date.now()+60000);
    const before=db.query("SELECT * FROM web_sessions").all();
    db.run("CREATE TEMP TRIGGER forbid_auth_update BEFORE UPDATE ON web_sessions BEGIN SELECT RAISE(ABORT,'request wrote'); END");
    db.run("CREATE TEMP TRIGGER forbid_auth_delete BEFORE DELETE ON web_sessions BEGIN SELECT RAISE(ABORT,'request wrote'); END");
    try {
      expect(getWebSession("expired-fixture")).toBeNull();expect(getWebSession("expired-fixture")).toBeNull();
      expect(db.query("SELECT * FROM web_sessions").all()).toEqual(before);
      expect(db.query("SELECT count(*) AS n FROM user_totp_registrations").get()).toEqual({n:1});
      expect(db.query("SELECT count(*) AS n FROM user_passkey_registrations").get()).toEqual({n:1});
    }finally{db.run("DROP TRIGGER forbid_auth_update");db.run("DROP TRIGGER forbid_auth_delete");}
    // Bun's changes count includes the logout-trigger registration deletion.
    expect(pruneExpiredAuthState(db).sessions).toBe(2);
    expect(db.query("SELECT count(*) AS n FROM web_sessions").get()).toEqual({n:0});
    expect(db.query("SELECT count(*) AS n FROM user_totp_registrations").get()).toEqual({n:0});
    expect(db.query("SELECT count(*) AS n FROM user_passkey_registrations").get()).toEqual({n:0});
  });
}
test("valid legacy migration failures cannot authenticate",()=>{
  const db=getDb();createWebSession("valid-legacy","default",3600,"totp");db.run("UPDATE web_sessions SET token='valid-legacy'");
  db.run("CREATE TEMP TRIGGER fail_legacy BEFORE UPDATE ON web_sessions BEGIN SELECT RAISE(ABORT,'migration failed'); END");
  try{expect(()=>getWebSession("valid-legacy")).toThrow("migration failed");}finally{db.run("DROP TRIGGER fail_legacy");}
  expect(getWebSession("valid-legacy")?.user_id).toBe("default");
});
