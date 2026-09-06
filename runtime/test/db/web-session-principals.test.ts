import { beforeEach, expect, test } from "bun:test";
import { initDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession, getWebSession, listUserWebSessions, revokeUserWebSession, revokeUserWebSessions } from "../../src/db/web-sessions.js";

beforeEach(() => { initDatabase(); getDb().exec("DELETE FROM web_sessions"); });

test("login correlation identifier is distinct from bearer token and hash", () => {
  const login = createWebSession("test-cookie", "alice", 60, "passkey");
  const row = getDb().query("SELECT token, session_id FROM web_sessions").get() as {token:string; session_id:string};
  expect(login.session_id).toStartWith("login-");
  expect(row.session_id).not.toBe(row.token);
  expect(row.session_id).not.toBe(login.token);
  expect(getWebSession("test-cookie")?.session_id).toBe(login.session_id);
  const listed=JSON.stringify(listUserWebSessions("alice"));
  expect(listed).not.toContain("test-cookie");
  expect(listed).not.toContain(row.token);
});

test("legacy plaintext rows acquire a stable non-secret identifier on lookup", () => {
  getDb().prepare("INSERT INTO web_sessions(token,user_id,auth_method,created_at,expires_at) VALUES (?,?,?,?,?)").run("legacy-cookie","default","totp",new Date().toISOString(),new Date(Date.now()+60_000).toISOString());
  const first=getWebSession("legacy-cookie");
  expect(first?.session_id).toStartWith("login-");
  expect(getWebSession("legacy-cookie")?.session_id).toBe(first?.session_id);
  expect(getDb().query("SELECT COUNT(*) AS n FROM web_sessions WHERE token = 'legacy-cookie'").get()).toEqual({n:0});
});

test("expired or malformed expiry records cannot authenticate", () => {
  createWebSession("expired", "alice", -1,"totp");
  createWebSession("malformed", "alice",60,"totp");
  getDb().query("UPDATE web_sessions SET expires_at = 'invalid' WHERE user_id = 'alice'").run();
  expect(getWebSession("expired")).toBeNull();
  expect(getWebSession("malformed")).toBeNull();
});

test("device and account revocation never revokes another user's cookie", () => {
  const a=createWebSession("alice-1","alice",60,"passkey");
  createWebSession("alice-2","alice",60,"totp");
  const b=createWebSession("bob-1","bob",60,"passkey");
  expect(revokeUserWebSession("alice",b.session_id!)).toBe(false);
  expect(revokeUserWebSession("alice",a.session_id!)).toBe(true);
  expect(getWebSession("alice-1")).toBeNull();
  expect(revokeUserWebSessions("alice")).toBe(1);
  expect(getWebSession("bob-1")?.user_id).toBe("bob");
});
