import { afterEach, beforeEach, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { createFamilyScheduledTask, inspectFamilyScheduledGrant, revokeFamilyScheduledGrant } from "../../src/db/family-scheduled-grants.js";
import { initializeFamilyScheduledGrants } from "../../src/db/family-scheduled-grants-schema.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { createOwnedRoot, archiveOwnedSession } from "../../src/db/owned-session-lifecycle.js";
import { getUser } from "../../src/db/users.js";
import { updateAdminToolPolicy } from "../../src/db/family-tool-restrictions.js";
import { createTask, deleteTask, getTaskById, updateTask } from "../../src/db/tasks.js";
import { authoriseExecutionIdentity } from "../../src/agent-pool/execution-identity.js";
import { pollScheduledRunsOnce, runScheduledTask } from "../../src/task-scheduler.js";
import { createCurrentPiclawScheduledRunStore } from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
let admin: AuthenticatedPrincipal, alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal;
function actor(id: string): AuthenticatedPrincipal {
  const user = getUser(getDb(), id)!;
  const login = createWebSession(`token-${id}`, id, 3600, "passkey");
  return { kind: "user", mode: "family-shared", userId: id, username: user.username, displayName: user.display_name,
    role: user.role, homeChatJid: user.home_chat_jid, authentication: { method: "passkey", sessionId: login.session_id!, expiresAt: login.expires_at } };
}
function config(mode: string) { writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode } } })); }
beforeEach(() => {
  ws = createTempWorkspace("scheduled-grants-"); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_DATA: ws.data, PICLAW_STORE: ws.store });
  mkdirSync(join(ws.workspace, ".piclaw")); config("family-shared"); closeDatabase(); initDatabase(); admin = actor("default");
  [alice, bob] = ["alice", "bob"].map(name => {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: "family.local" });
    return actor(user.id);
  });
});
afterEach(() => { closeDatabase(); restore(); ws.cleanup(); });
const input = (allowed_tools = ["read", "messages"]) => ({ prompt: "Retain exact prompt\nincluding formatting", scheduled_for: new Date(Date.now() + 60_000).toISOString(), allowed_tools });
const create = () => createFamilyScheduledTask(getDb(), alice, alice.homeChatJid!, input());
function count(table: string) { return (getDb().query(`SELECT count(*) n FROM ${table}`).get() as any).n; }

test("task, revision and owner grant commit atomically as paused with distinct user and service attribution", () => {
  const db = getDb(), data = input(), ids = createFamilyScheduledTask(db, alice, alice.homeChatJid!, data);
  const task = getTaskById(ids.task_id)!, grant = db.query("SELECT * FROM family_scheduled_grants WHERE id=?").get(ids.grant_id) as any;
  expect(task).toMatchObject({ status: "paused", revision: 1, prompt: data.prompt, chat_jid: alice.homeChatJid, task_kind: "agent", schedule_type: "once", next_run: data.scheduled_for, model: null, command: null, notify_on_complete: 0 });
  expect(grant).toMatchObject({ task_id: task.id, owner_user_id: alice.userId, initiated_by_user_id: alice.userId, execution_service: "scheduler", execution_kind: "scheduled", login_session_id: alice.authentication.sessionId });
  expect(grant.payload_hash).toMatch(/^[a-f0-9]{64}$/); expect(grant.authority_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(grant)).not.toContain(`token-${alice.userId}`);
  const checked = inspectFamilyScheduledGrant(db, ids.grant_id);
  expect(checked.prompt).toBe(data.prompt); expect(checked.toolPolicy.allowed).toEqual(["read", "messages"]);
  expect(Object.isFrozen(checked)).toBe(true); expect(Object.isFrozen(checked.toolPolicy.allowed)).toBe(true);
  expect(db.query("SELECT status FROM service_effect_s07_tasks WHERE task_id=?").get(ids.task_id)).toEqual({ status: "paused" });
  db.exec("CREATE TRIGGER grant_failure BEFORE INSERT ON family_scheduled_grants BEGIN SELECT RAISE(ABORT,'grant write failed'); END");
  expect(() => create()).toThrow("grant write failed"); expect(count("scheduled_tasks")).toBe(1); expect(count("service_effect_s07_task_revisions")).toBe(1); expect(count("family_scheduled_grants")).toBe(1);
});

test("creation rejects foreign/admin impersonation, stale login, hidden fields, invalid schedules and wider tools", () => {
  const db = getDb(), data = input();
  for (const owner of [admin, bob]) expect(() => createFamilyScheduledTask(db, owner, alice.homeChatJid!, data)).toThrow("Session access denied");
  for (const next of [{ ...data, owner_user_id: bob.userId }, { ...data, prompt: "" }, { ...data, prompt: "é".repeat(52 * 1024) }, { ...data, scheduled_for: "tomorrow" },
    { ...data, scheduled_for: new Date(Date.now() - 1000).toISOString() }, { ...data, scheduled_for: new Date(Date.now() + 400 * 86400_000).toISOString() },
    { ...data, allowed_tools: ["bash"] }, { ...data, allowed_tools: ["read", "read"] }, { ...data, model: "test/other" }]) {
    expect(() => createFamilyScheduledTask(db, alice, alice.homeChatJid!, next)).toThrow();
  }
  db.query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now() - 600_000).toISOString(), alice.authentication.sessionId!);
  expect(() => create()).toThrow(); alice = actor(alice.userId);
  updateAdminToolPolicy(db, admin, alice.userId, { confirm_username: "alice", expected_revision: 0, denied_tools: ["read"] });
  expect(() => create()).toThrow();
  expect(count("family_scheduled_grants")).toBe(0); expect(count("scheduled_tasks")).toBe(0);
  config("single-user"); expect(() => createFamilyScheduledTask(db, alice, alice.homeChatJid!, input([]))).toThrow();
});

test("preflight survives logout and profile rename, but policy can never widen the issued ceiling", () => {
  const db = getDb(), ids = create(); db.exec("DELETE FROM web_sessions");
  expect(inspectFamilyScheduledGrant(db, ids.grant_id).ownerUserId).toBe(alice.userId);
  db.query("UPDATE users SET display_name='New name',username='alice-new' WHERE id=?").run(alice.userId);
  expect(inspectFamilyScheduledGrant(db, ids.grant_id).initiatedByUserId).toBe(alice.userId);
  admin = actor("default");
  updateAdminToolPolicy(db, admin, alice.userId, { confirm_username: "alice-new", expected_revision: 0, denied_tools: ["read"] });
  expect(inspectFamilyScheduledGrant(db, ids.grant_id).toolPolicy.allowed).toEqual(["messages"]);
  updateAdminToolPolicy(db, admin, alice.userId, { confirm_username: "alice-new", expected_revision: 1, denied_tools: [] });
  expect(inspectFamilyScheduledGrant(db, ids.grant_id).toolPolicy.allowed).toEqual(["read", "messages"]);
});

test("owner revocation is append-only, idempotent, atomic and unavailable to foreign administrators", () => {
  const db = getDb(), ids = create();
  for (const other of [bob, admin]) expect(() => revokeFamilyScheduledGrant(db, other, ids.grant_id)).toThrow("Session access denied");
  db.exec("CREATE TRIGGER revoke_failure BEFORE INSERT ON family_scheduled_grant_revocations BEGIN SELECT RAISE(ABORT,'revoke failed'); END");
  expect(() => revokeFamilyScheduledGrant(db, alice, ids.grant_id)).toThrow("revoke failed"); expect(inspectFamilyScheduledGrant(db, ids.grant_id)).toBeTruthy();
  db.exec("DROP TRIGGER revoke_failure"); revokeFamilyScheduledGrant(db, alice, ids.grant_id); revokeFamilyScheduledGrant(db, alice, ids.grant_id);
  expect(count("family_scheduled_grant_revocations")).toBe(1); expect(() => inspectFamilyScheduledGrant(db, ids.grant_id)).toThrow();
  expect(() => db.query("UPDATE family_scheduled_grants SET allowed_tools='[]' WHERE id=?").run(ids.grant_id)).toThrow("immutable");
  expect(() => db.query("DELETE FROM family_scheduled_grants WHERE id=?").run(ids.grant_id)).toThrow("cannot be deleted");
  expect(() => db.query("DELETE FROM family_scheduled_grant_revocations WHERE grant_id=?").run(ids.grant_id)).toThrow("cannot be deleted");
});

test("account disable or role change permanently revokes grants even after later restoration", () => {
  const db = getDb(); const first = create();
  db.query("UPDATE users SET enabled=0 WHERE id=?").run(alice.userId); db.query("UPDATE users SET enabled=1 WHERE id=?").run(alice.userId);
  expect(() => inspectFamilyScheduledGrant(db, first.grant_id)).toThrow();
  const next = create(); db.query("UPDATE users SET role='admin' WHERE id=?").run(alice.userId); db.query("UPDATE users SET role='member' WHERE id=?").run(alice.userId);
  expect(() => inspectFamilyScheduledGrant(db, next.grant_id)).toThrow();
  expect(db.query("SELECT DISTINCT reason FROM family_scheduled_grant_revocations").all()).toEqual([{ reason: "account_changed" }]);
});

test("task edits, tampering and deletion cannot restore the grant by returning to the old payload", () => {
  const db = getDb();
  const first = create(); updateTask(first.task_id, { prompt: "different" }); updateTask(first.task_id, { prompt: input().prompt });
  expect(() => inspectFamilyScheduledGrant(db, first.grant_id)).toThrow();
  const second = create(); db.query("UPDATE scheduled_tasks SET prompt='tampered' WHERE id=?").run(second.task_id);
  db.query("UPDATE scheduled_tasks SET prompt=? WHERE id=?").run(input().prompt, second.task_id);
  expect(() => inspectFamilyScheduledGrant(db, second.grant_id)).toThrow();
  const third = create(); deleteTask(third.task_id); expect(() => inspectFamilyScheduledGrant(db, third.grant_id)).toThrow();
  expect(db.query("SELECT reason FROM family_scheduled_grant_revocations WHERE grant_id=?").get(third.grant_id)).toEqual({ reason: "task_deleted" });
  const fourth = create(); db.exec("DROP TRIGGER family_scheduled_task_changed"); db.query("UPDATE scheduled_tasks SET prompt='undetected-by-trigger' WHERE id=?").run(fourth.task_id);
  expect(() => inspectFamilyScheduledGrant(db, fourth.grant_id)).toThrow(); // payload hash still rejects corruption
});

test("target namespace, archive state and durable snapshot corruption reject preflight", () => {
  const db = getDb(); const root = createOwnedRoot(db, alice, "later"); const ids = createFamilyScheduledTask(db, alice, root.chat_jid, input());
  archiveOwnedSession(db, alice, root.chat_jid); expect(() => inspectFamilyScheduledGrant(db, ids.grant_id)).toThrow();
  const second = create(); db.query("UPDATE chat_branches SET handle_owner_id='' WHERE chat_jid=?").run(alice.homeChatJid!);
  expect(() => inspectFamilyScheduledGrant(db, second.grant_id)).toThrow(); db.query("UPDATE chat_branches SET handle_owner_id=? WHERE chat_jid=?").run(alice.userId, alice.homeChatJid!);
  const snapshot = db.query("SELECT snapshot_json FROM service_effect_s07_task_revisions WHERE task_id=?").get(second.task_id) as any;
  db.query("UPDATE service_effect_s07_task_revisions SET snapshot_json='{}' WHERE task_id=?").run(second.task_id);
  expect(() => inspectFamilyScheduledGrant(db, second.grant_id)).toThrow();
  db.query("UPDATE service_effect_s07_task_revisions SET snapshot_json=? WHERE task_id=?").run(snapshot.snapshot_json, second.task_id);
  expect(() => inspectFamilyScheduledGrant(db, second.grant_id)).toThrow();
  const third = create(); db.exec('DROP TRIGGER family_scheduled_revision_changed');
  const original = db.query("SELECT snapshot_json FROM service_effect_s07_task_revisions WHERE task_id=?").get(third.task_id) as any;
  const tampered = { ...JSON.parse(original.snapshot_json), timezone: 'Pacific/Honolulu' };
  db.query("UPDATE service_effect_s07_task_revisions SET snapshot_json=? WHERE task_id=?").run(JSON.stringify(tampered), third.task_id);
  expect(() => inspectFamilyScheduledGrant(db, third.grant_id)).toThrow(); // decoder recomputes hash, even without trigger
});

test("restored lifecycle and authority projections do not resurrect grants", () => {
  const db = getDb();
  for (const field of ['next_run', 'last_run', 'last_result', 'status']) {
    const ids = create(), original = getTaskById(ids.task_id)!;
    const changed = field === 'status' ? 'completed' : field === 'last_result' ? 'ran' : new Date(Date.now()+120000).toISOString();
    db.query(`UPDATE scheduled_tasks SET ${field}=? WHERE id=?`).run(changed, ids.task_id);
    db.query(`UPDATE scheduled_tasks SET ${field}=? WHERE id=?`).run(original[field as keyof typeof original] as any, ids.task_id);
    expect(() => inspectFamilyScheduledGrant(db, ids.grant_id)).toThrow();
  }
  const ids = create(), due = getTaskById(ids.task_id)!.next_run;
  db.query("UPDATE service_effect_s07_tasks SET next_run_at=NULL WHERE task_id=?").run(ids.task_id);
  db.query("UPDATE service_effect_s07_tasks SET next_run_at=? WHERE task_id=?").run(due, ids.task_id);
  expect(() => inspectFamilyScheduledGrant(db, ids.grant_id)).toThrow();
  const inserted = create();
  db.query(`INSERT INTO service_effect_s07_task_revisions(task_id,revision,config_hash,snapshot_json,authored_at)
    SELECT task_id,2,?,snapshot_json,authored_at FROM service_effect_s07_task_revisions WHERE task_id=?`).run('a'.repeat(64), inserted.task_id);
  expect(() => inspectFamilyScheduledGrant(db, inserted.grant_id)).toThrow();
});

test("grants persist across a database copy/reopen and creation uses the supplied connection exclusively", () => {
  const ids = create(), db = getDb(), path = join(ws.workspace, "reopened.sqlite");
  db.query("VACUUM INTO ?").run(path); const copy = new Database(path);
  try {
    initializeFamilyScheduledGrants(copy); expect(inspectFamilyScheduledGrant(copy, ids.grant_id)).toEqual(inspectFamilyScheduledGrant(db, ids.grant_id));
    const next = createFamilyScheduledTask(copy, alice, alice.homeChatJid!, input([]));
    expect(copy.query("SELECT id FROM scheduled_tasks WHERE id=?").get(next.task_id)).toEqual({ id: next.task_id });
    expect(db.query("SELECT id FROM scheduled_tasks WHERE id=?").get(next.task_id)).toBeNull();
    revokeFamilyScheduledGrant(copy, alice, next.grant_id); expect(() => inspectFamilyScheduledGrant(copy, next.grant_id)).toThrow();
  } finally { copy.close(); }
});

test("prepared grants cannot activate, claim, execute or masquerade as interactive authority", async () => {
  const db = getDb(), ids = create(), task = getTaskById(ids.task_id)!;
  expect(() => updateTask(ids.task_id, { status: "active" })).toThrow("dispatch is unavailable");
  expect(() => db.query("UPDATE service_effect_s07_tasks SET status='active' WHERE task_id=?").run(ids.task_id)).toThrow("dispatch is unavailable");
  const forbidden = new Proxy({}, { get: () => { throw Error("Unexpected worker dependency"); } });
  expect((await runScheduledTask(task, forbidden as any)).status).toBe("skipped");
  await pollScheduledRunsOnce(forbidden as any, forbidden as any); expect(count("service_effect_s07_occurrences")).toBe(0);
  for (const kind of ["scheduled", "followup", "side-prompt", "dream", "delegate"] as const) {
    expect(() => authoriseExecutionIdentity(db, "family-shared", alice.homeChatJid!, { actorUserId: alice.userId, ownerUserId: alice.userId, chatJid: alice.homeChatJid!, kind, grantId: ids.grant_id } as any)).toThrow();
  }
  expect(() => authoriseExecutionIdentity(db, "family-shared", alice.homeChatJid!, { actorUserId: alice.userId, ownerUserId: alice.userId, chatJid: alice.homeChatJid!, kind: "interactive", authenticationSessionId: ids.grant_id })).toThrow();
  config("single-user"); expect(() => inspectFamilyScheduledGrant(db, ids.grant_id)).toThrow();
  expect(() => updateTask(ids.task_id, { status: "active" })).toThrow("dispatch is unavailable");
  db.exec("PRAGMA foreign_keys=ON"); const built = createCurrentPiclawScheduledRunStore(db, { hitFault: () => false, recordTrace: () => undefined });
  if (!built.ok) throw Error(built.error._tag);
  const result = await built.value.claimDue({ now: new Date(Date.now() + 120_000).toISOString(), limit: 100, workerId: "test", leaseTokenPrefix: "test-token", leaseDurationMs: 60000, reclaimAuthorities: [] });
  expect(result).toEqual({ ok: true, value: [] });
});

test("schema installation does not adopt or change legacy tasks", () => {
  const db = getDb(); createTask({ id: "legacy-task", chat_jid: "web:default", prompt: "legacy", schedule_type: "once", schedule_value: new Date(Date.now() + 60000).toISOString(), next_run: new Date(Date.now() + 60000).toISOString(), status: "active", created_at: new Date().toISOString() });
  const before = getTaskById("legacy-task"); initializeFamilyScheduledGrants(db); initializeFamilyScheduledGrants(db);
  expect(getTaskById("legacy-task")).toEqual(before); expect(count("family_scheduled_grants")).toBe(0);
  updateTask("legacy-task", { status: "paused" }); updateTask("legacy-task", { status: "active" }); expect(getTaskById("legacy-task")?.status).toBe("active");
});
