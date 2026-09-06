import { beforeEach, afterEach, expect, test } from "bun:test";
import "../helpers.js";
import Database from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { createUser, updateUser, getUser } from "../../src/db/users.js";
import { ensureChatBranch, getChatBranchByAgentName, getChatBranchByChatJid, renameChatBranchIdentity, restoreChatBranchIdentity } from "../../src/db/chat-branches.js";
import { storeChatMetadata } from "../../src/db/messages.js";
import { assignRootOwner, provisionUserHome } from "../../src/db/session-ownership.js";
import { initializeSessionHandleSchema, migrateOwnedSessionHandles, listOwnedSessionHandles, renameOwnedSessionHandle, resolveOwnedSessionHandle } from "../../src/db/session-handles.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";

let alice: string, bob: string;
function principal(id = alice): AuthenticatedPrincipal {
  return { kind: "user", userId: id, username: id, displayName: id, role: "member", mode: "family-shared", homeChatJid: null,
    authentication: { method: "totp", sessionId: "login", expiresAt: null } };
}
function chat(jid: string, name: string, root = jid, parent?: string) {
  storeChatMetadata(jid, new Date().toISOString(), name);
  return ensureChatBranch({ chat_jid: jid, agent_name: name, root_chat_jid: root, parent_branch_id: parent });
}
beforeEach(() => {
  closeDatabase(); initDatabase(); const db = getDb();
  alice = createUser(db, { username: "alice", displayName: "Alice" }).id;
  bob = createUser(db, { username: "bob", displayName: "Bob" }).id;
  const a = chat("web:alice", "alice"); chat("web:bob", "bob");
  chat("web:fork", "alice-fork", "web:alice", a.branch_id);
  chat("web:other-root", "other-root");
  provisionUserHome(db, alice, "web:alice"); provisionUserHome(db, bob, "web:bob"); assignRootOwner(db, "web:other-root", alice);
  updateUser(db, alice, { enabled: true }); updateUser(db, bob, { enabled: true });
});
afterEach(() => closeDatabase());

test("explicit namespace migration is idempotent and leaves stable identities and legacy names intact", () => {
  const db = getDb();
  const before = getChatBranchByChatJid("web:alice");
  expect(getChatBranchByAgentName("alice")?.chat_jid).toBe("web:alice");
  expect(() => renameOwnedSessionHandle(db, principal(), undefined, "research")).toThrow();
  migrateOwnedSessionHandles(db); migrateOwnedSessionHandles(db);
  expect(getChatBranchByChatJid("web:alice")).toEqual(before);
  expect(getUser(db, alice)?.home_chat_jid).toBe("web:alice");
  expect(getChatBranchByAgentName("alice")).toBeNull();
  expect(resolveOwnedSessionHandle(db, principal(), "@ALICE")?.chat_jid).toBe("web:alice");
  expect(listOwnedSessionHandles(db, principal()).map(row => row.chat_jid).sort()).toEqual(["web:alice", "web:fork", "web:other-root"]);
});

test("two owners can claim research, but active roots and forks of one owner share a namespace", () => {
  const db = getDb(); migrateOwnedSessionHandles(db);
  const before = getChatBranchByChatJid("web:alice")!;
  renameOwnedSessionHandle(db, principal(), "web:alice", "@Research");
  renameOwnedSessionHandle(db, principal(bob), "web:bob", "research");
  const renamed = getChatBranchByChatJid("web:alice")!;
  for (const key of ["branch_id", "chat_jid", "root_chat_jid", "parent_branch_id", "created_at"] as const) expect(renamed[key]).toBe(before[key]);
  for (const jid of ["web:fork", "web:other-root"]) expect(() => renameOwnedSessionHandle(db, principal(), jid, "RESEARCH")).toThrow("UNIQUE");
  expect(resolveOwnedSessionHandle(db, principal(), "research")?.chat_jid).toBe("web:alice");
  expect(resolveOwnedSessionHandle(db, principal(bob), "research")?.chat_jid).toBe("web:bob");
  expect(getChatBranchByAgentName("research")).toBeNull();
  expect(getUser(db, alice)?.home_chat_jid).toBe("web:alice");
});

test("owner-local miss and forged namespace row never become cross-owner lookup or rename", () => {
  const db = getDb(); migrateOwnedSessionHandles(db);
  renameOwnedSessionHandle(db, principal(bob), "web:bob", "research");
  expect(resolveOwnedSessionHandle(db, principal(), "research")).toBeNull();
  expect(() => renameOwnedSessionHandle(db, principal(), "web:bob", "stolen")).toThrow("Session access denied");
  db.query("UPDATE chat_branches SET handle_owner_id=? WHERE chat_jid='web:bob'").run(alice);
  expect(() => resolveOwnedSessionHandle(db, principal(), "research")).toThrow("Session access denied");
  expect(listOwnedSessionHandles(db, principal()).some(row => row.chat_jid === "web:bob")).toBe(false);
  expect(() => migrateOwnedSessionHandles(db)).toThrow("Session access denied");
});

test("legacy ensure/rename/restore cannot mutate migrated owner namespaces", () => {
  const db = getDb(); migrateOwnedSessionHandles(db);
  expect(() => ensureChatBranch({ chat_jid: "web:alice", agent_name: "renamed" })).toThrow();
  expect(() => ensureChatBranch({ chat_jid: "web:new-child", root_chat_jid: "web:alice" })).toThrow();
  expect(() => renameChatBranchIdentity({ chat_jid: "web:alice", agent_name: "renamed" })).toThrow();
  expect(() => restoreChatBranchIdentity({ chat_jid: "web:alice", agent_name: "renamed" })).toThrow();
  expect(getChatBranchByChatJid("web:alice")?.agent_name).toBe("alice");
});

test("disabled accounts and archived or malformed branches cannot resolve or rename", () => {
  const db = getDb(); migrateOwnedSessionHandles(db);
  updateUser(db, alice, { enabled: false });
  expect(() => resolveOwnedSessionHandle(db, principal(), "alice")).toThrow();
  expect(() => renameOwnedSessionHandle(db, principal(), undefined, "new")).toThrow();
  updateUser(db, alice, { enabled: true });
  db.query("UPDATE chat_branches SET archived_at=? WHERE chat_jid='web:fork'").run(new Date().toISOString());
  expect(resolveOwnedSessionHandle(db, principal(), "alice-fork")).toBeNull();
  expect(() => renameOwnedSessionHandle(db, principal(), "web:fork", "new")).toThrow();
  db.exec("UPDATE chat_branches SET archived_at=NULL,parent_branch_id='missing' WHERE chat_jid='web:fork'");
  expect(() => resolveOwnedSessionHandle(db, principal(), "alice-fork")).toThrow();
});

test("migration rolls back entirely if any registered branch lacks ownership", () => {
  chat("web:unowned", "unowned");
  expect(() => migrateOwnedSessionHandles(getDb())).toThrow();
  expect((getDb().query("SELECT count(*) AS n FROM chat_branches WHERE handle_owner_id!=''").get() as any).n).toBe(0);
});

test("legacy auto suffix, rename collision and archived-name reuse remain unchanged", () => {
  expect(chat("web:legacy", "alice").agent_name).toBe("alice-2");
  expect(() => renameChatBranchIdentity({ chat_jid: "web:legacy", agent_name: "alice" })).toThrow("already in use");
  getDb().exec("UPDATE chat_branches SET archived_at='2026-01-01' WHERE chat_jid='web:legacy'");
  expect(chat("web:legacy2", "alice-2").agent_name).toBe("alice-2");
  expect(restoreChatBranchIdentity({ chat_jid: "web:legacy" }).agent_name).toBe("alice-2-2");
});

test("namespace schema survives reopen and SQLite serialises duplicate claims and restore collisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-handles-"));
  const path = join(dir, "db.sqlite");
  const a = new Database(path);
  let b: Database | undefined;
  try {
    a.exec("CREATE TABLE chat_branches (branch_id TEXT PRIMARY KEY,agent_name TEXT,archived_at TEXT)");
    initializeSessionHandleSchema(a);
    a.exec("INSERT INTO chat_branches VALUES ('a','research',NULL,'alice'),('b','research',NULL,'bob'),('c','other',NULL,'alice'),('d','research','archived','alice')");
    b = new Database(path); initializeSessionHandleSchema(b);
    expect(() => b!.exec("UPDATE chat_branches SET agent_name='RESEARCH' WHERE branch_id='c'")).toThrow("UNIQUE");
    expect(() => b!.exec("UPDATE chat_branches SET archived_at=NULL WHERE branch_id='d'")).toThrow("UNIQUE");
    a.exec("UPDATE chat_branches SET agent_name='new' WHERE branch_id='a'");
    b.exec("UPDATE chat_branches SET agent_name='Research' WHERE branch_id='c'");
    expect((b.query("SELECT count(*) AS n FROM chat_branches WHERE lower(agent_name)='research' AND archived_at IS NULL").get() as any).n).toBe(2);
  } finally { b?.close(); a.close(); rmSync(dir, { recursive: true, force: true }); }
});
