import { afterEach, beforeEach, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { createFamilyScheduledTask, revokeFamilyScheduledGrant } from "../../src/db/family-scheduled-grants.js";
import { claimFamilyScheduledOccurrence as claim, renewFamilyScheduledOccurrence as renew, consumeFamilyScheduledOccurrence as consume } from "../../src/db/family-scheduled-occurrences.js";
import { initializeFamilyScheduledOccurrences } from "../../src/db/family-scheduled-occurrences-schema.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { getUser } from "../../src/db/users.js";
import { updateAdminToolPolicy } from "../../src/db/family-tool-restrictions.js";
import { authoriseExecutionIdentity } from "../../src/agent-pool/execution-identity.js";
import { getTaskById, updateTask } from "../../src/db/tasks.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void, admin: AuthenticatedPrincipal, alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal;
let clock: number, due: number; const realNow = Date.now;
function actor(id: string): AuthenticatedPrincipal {
  const user = getUser(getDb(), id)!, login = createWebSession(`token-${id}`, id, 3600, "passkey");
  return { kind: "user", mode: "family-shared", userId: id, username: user.username, displayName: user.display_name,
    role: user.role, homeChatJid: user.home_chat_jid, authentication: { method: "passkey", sessionId: login.session_id!, expiresAt: login.expires_at } };
}
beforeEach(() => {
  ws = createTempWorkspace("family-occurrences-"); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  mkdirSync(join(ws.workspace, ".piclaw")); writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
  closeDatabase(); initDatabase(); admin = actor("default");
  [alice, bob] = ["alice", "bob"].map(name => {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: "family.local" }); return actor(user.id);
  });
  clock = realNow() + 10; due = clock + 1000; Date.now = () => clock;
});
afterEach(() => { Date.now = realNow; closeDatabase(); restore(); ws.cleanup(); });
function grant(owner = alice, allowed_tools = ["read", "messages"]) {
  return createFamilyScheduledTask(getDb(), owner, owner.homeChatJid!, { prompt: `private prompt for ${owner.username}`, scheduled_for: new Date(due).toISOString(), allowed_tools });
}
function snapshot(database = getDb()) {
  return JSON.stringify(["family_scheduled_occurrences", "family_scheduled_occurrence_events"].map(table => database.query(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}
function record() { return getDb().query("SELECT * FROM family_scheduled_occurrences").get() as any; }

test("due claim stores only a hashed capability, rotates renewal and consumes exactly once", () => {
  const db = getDb(), ids = grant(); expect(() => claim(db, ids.grant_id, "worker-a")).toThrow(); expect(snapshot()).toBe("[[],[]]");
  clock = due; const first = claim(db, ids.grant_id, "worker-a");
  expect(first).toMatchObject({ grant_id: ids.grant_id, attempt: 1, version: 1, worker_id: "worker-a" }); expect(first.token).toMatch(/^[\w-]{43}$/);
  expect(record().lease_expires_at).toBe(clock+60000); expect(snapshot()).not.toContain(first.token); expect(snapshot()).not.toContain("private prompt");
  expect(() => claim(db, ids.grant_id, "worker-b")).toThrow(); clock += 1000;
  const next = renew(db, first); expect(next.version).toBe(2); expect(next.token).not.toBe(first.token); expect(() => renew(db, first)).toThrow();
  const consumed = consume(db, next); expect(consumed).toMatchObject({ ownerUserId: alice.userId, initiatedByUserId: alice.userId, service: "scheduler", chatJid: alice.homeChatJid, prompt: "private prompt for alice" });
  expect(Object.isFrozen(consumed.toolPolicy.allowed)).toBe(true); expect(record()).toMatchObject({ state: "consumed", token_hash: null, lease_expires_at: null });
  const before = snapshot(); expect(() => consume(db, next)).toThrow(); expect(() => renew(db, next)).toThrow(); clock += 120000; expect(() => claim(db, ids.grant_id, "worker-b")).toThrow(); expect(snapshot()).toBe(before);
  expect(getTaskById(ids.task_id)?.status).toBe("paused");
  expect(() => authoriseExecutionIdentity(db, "family-shared", alice.homeChatJid!, { actorUserId: alice.userId, ownerUserId: alice.userId, chatJid: alice.homeChatJid!, kind: "scheduled", ...next } as any)).toThrow();
});

test("expired unconsumed leases reclaim with a new attempt; old workers and exact expiry cannot act", () => {
  const db = getDb(), ids = grant(); clock = due; const first = claim(db, ids.grant_id, "worker-a"); clock += 60000;
  expect(() => renew(db, first)).toThrow(); expect(() => consume(db, first)).toThrow();
  const next = claim(db, ids.grant_id, "worker-b"); expect(next).toMatchObject({ occurrence_id: first.occurrence_id, attempt: 2, version: 2 });
  expect(next.token).not.toBe(first.token); expect(() => consume(db, { ...next, token: first.token })).toThrow(); expect(() => consume(db, first)).toThrow();
  expect(consume(db, next).attempt).toBe(2);
});

test("foreign grant, worker, version, token or injected authority inputs fail without writes", () => {
  const db = getDb(), a = grant(), b = grant(bob); clock = due; const lease = claim(db, a.grant_id, "worker-a"), before = snapshot();
  for (const invalid of [{ ...lease, grant_id: b.grant_id }, { ...lease, occurrence_id: "foreign" }, { ...lease, worker_id: "worker-b" }, { ...lease, attempt: 2 },
    { ...lease, version: 2 }, { ...lease, token: "x".repeat(43) }, { ...lease, token: "short" }, { ...lease, now: clock + 100000 }, { ...lease, ownerUserId: bob.userId }]) {
    expect(() => renew(db, invalid)).toThrow(); expect(() => consume(db, invalid)).toThrow();
  }
  expect(snapshot()).toBe(before); expect(() => claim(db, b.grant_id, "bad\nworker")).toThrow();
});

test("renewal and reclaim retain the narrowed occurrence tool ceiling after live policy restoration", () => {
  const db = getDb(), ids = grant(); clock = due; const first = claim(db, ids.grant_id, "worker-a");
  updateAdminToolPolicy(db, admin, alice.userId, { confirm_username: "alice", expected_revision: 0, denied_tools: ["read"] });
  const renewed = renew(db, first);
  updateAdminToolPolicy(db, admin, alice.userId, { confirm_username: "alice", expected_revision: 1, denied_tools: [] });
  clock += 60000; const reclaimed = claim(db, ids.grant_id, "worker-b");
  expect(() => consume(db, renewed)).toThrow(); expect(consume(db, reclaimed).toolPolicy.allowed).toEqual(["messages"]);
});

test("live grant revocation, account disable and task changes fence already issued leases", () => {
  const db = getDb();
  for (const change of ["revoke", "disable", "task"]) {
    due = clock + 1000; const ids = grant(); clock = due; const lease = claim(db, ids.grant_id, "worker");
    if (change === "revoke") revokeFamilyScheduledGrant(db, alice, ids.grant_id);
    if (change === "disable") { db.query("UPDATE users SET enabled=0 WHERE id=?").run(alice.userId); db.query("UPDATE users SET enabled=1 WHERE id=?").run(alice.userId); }
    if (change === "task") updateTask(ids.task_id, { prompt: "changed" });
    const before = snapshot(); expect(() => renew(db, lease)).toThrow(); expect(() => consume(db, lease)).toThrow(); clock+=60000; expect(() => claim(db, ids.grant_id, "other")).toThrow(); expect(snapshot()).toBe(before);
  }
});

test("audit failure rolls back claim, renew, reclaim and consumption including token rotation", () => {
  const db = getDb(), ids = grant(); clock = due;
  const fail = () => db.exec("CREATE TRIGGER fail_occurrence_event BEFORE INSERT ON family_scheduled_occurrence_events BEGIN SELECT RAISE(ABORT,'audit failed'); END");
  const clear = () => db.exec("DROP TRIGGER fail_occurrence_event");
  fail(); expect(() => claim(db, ids.grant_id, "worker")).toThrow("audit failed"); expect(snapshot()).toBe("[[],[]]"); clear();
  const lease = claim(db, ids.grant_id, "worker"), before = snapshot(); fail();
  expect(() => renew(db, lease)).toThrow("audit failed"); expect(snapshot()).toBe(before); expect(() => consume(db, lease)).toThrow("audit failed"); expect(snapshot()).toBe(before);
  clock+=60000; expect(() => claim(db, ids.grant_id, "other")).toThrow("audit failed"); expect(snapshot()).toBe(before); clear();
  consume(db, claim(db, ids.grant_id, "other"));
});

test("clock rollback, malformed stored lease and immutable terminal history fail closed", () => {
  const db = getDb(), ids = grant(); clock=due; const lease=claim(db,ids.grant_id,"worker");
  clock--; expect(() => renew(db,lease)).toThrow(); clock++;
  expect(() => db.query("UPDATE family_scheduled_occurrences SET version=version+1,token_hash=NULL").run()).toThrow();
  expect(() => db.query("UPDATE family_scheduled_occurrences SET version=version+1,token_hash=?,allowed_tools='[\"bash\"]'").run("a".repeat(64))).toThrow("cannot widen");
  db.exec("DROP TRIGGER family_scheduled_occurrence_transition"); db.query("UPDATE family_scheduled_occurrences SET token_hash=?").run("g".repeat(64)); expect(() => renew(db,lease)).toThrow();
  expect(() => db.exec("UPDATE family_scheduled_occurrences SET owner_user_id='foreign'")).toThrow("immutable");
  expect(() => db.exec("DELETE FROM family_scheduled_occurrences")).toThrow("cannot be deleted");
  expect(() => db.exec("DELETE FROM family_scheduled_occurrence_events")).toThrow("cannot be deleted");
});

test("missing audit history fails closed and raw token cannot be accepted as a worker label", () => {
  const db=getDb(), ids=grant(); clock=due; const lease=claim(db,ids.grant_id,"worker");
  clock+=60000; expect(() => claim(db,ids.grant_id,lease.token)).toThrow();
  const reclaimed=claim(db,ids.grant_id,"other");
  db.exec("DROP TRIGGER family_scheduled_occurrence_event_no_delete");
  db.query("DELETE FROM family_scheduled_occurrence_events WHERE occurrence_id=? AND version=1").run(lease.occurrence_id);
  expect(() => consume(db,reclaimed)).toThrow();
});

test("separate connections share a claim and persisted consume fence across reopen", () => {
  const ids = grant(), path=join(ws.workspace,"occurrences.sqlite"); getDb().query("VACUUM INTO ?").run(path);
  const one=new Database(path), two=new Database(path); one.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000"); two.exec("PRAGMA busy_timeout=1000");
  try {
    clock=due; const lease=claim(one,ids.grant_id,"one"); expect(() => claim(two,ids.grant_id,"two")).toThrow();
    one.exec("BEGIN IMMEDIATE"); try { expect(() => renew(two,lease)).toThrow(); } finally { one.exec("ROLLBACK"); }
    consume(two,lease); initializeFamilyScheduledOccurrences(one); expect(() => consume(one,lease)).toThrow();
  } finally { one.close(); two.close(); }
  const reopened=new Database(path); try { expect(() => claim(reopened,ids.grant_id,"three")).toThrow(); expect(() => reopened.exec("UPDATE family_scheduled_occurrences SET state='claimed'")).toThrow("terminal"); } finally { reopened.close(); }
});

test("logout does not revoke reservations; invalid/non-family config does not expose them", () => {
  const db=getDb(), ids=grant(); clock=due; db.exec("DELETE FROM web_sessions"); const lease=claim(db,ids.grant_id,"worker");
  const path=join(ws.workspace,".piclaw/config.json"), before=snapshot();
  for (const text of ['{', JSON.stringify({domains:{access:{mode:'single-user'}}}), JSON.stringify({domains:{access:{mode:'isolated-containers'}}})]) {
    writeFileSync(path,text); expect(() => renew(db,lease)).toThrow(); expect(() => consume(db,lease)).toThrow(); expect(snapshot()).toBe(before);
  }
  writeFileSync(path,JSON.stringify({domains:{access:{mode:'family-shared'}}})); expect(consume(db,lease).ownerUserId).toBe(alice.userId);
});
