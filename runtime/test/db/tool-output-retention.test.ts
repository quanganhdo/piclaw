import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTempWorkspace, setEnv, withTempWorkspaceEnv } from "../helpers.js";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { storeToolOutputWithChunks, deleteToolOutputsBefore } from "../../src/db/tool-outputs.js";
import { storeChatMetadata } from "../../src/db/messages.js";
import { assignRootOwner } from "../../src/db/session-ownership.js";
import type { ToolOutputScope } from "../../src/core/tool-output-access.js";

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
beforeEach(() => { ws = createTempWorkspace("output-retention-"); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data }); closeDatabase(); initDatabase(); });
afterEach(() => { closeDatabase(); restore(); ws.cleanup(); });
const old = "2000-01-01T00:00:00.000Z", fresh = "2999-01-01T00:00:00.000Z", cutoff = "2026-01-01T00:00:00.000Z";
function seed(count: number, scope: ToolOutputScope | null = null, prefix = "expired") {
  const db = getDb();
  db.transaction(() => {
    for (let n = 0; n < count; n++) storeToolOutputWithChunks({ id: `${prefix}-${n}`, created_at: old,
      ...(scope ? { owner_user_id: scope.ownerUserId, root_branch_id: scope.rootBranchId, source_branch_id: scope.sourceBranchId, chat_jid: scope.chatJid, execution_kind: scope.executionKind } : {}),
    }, [`needle ${n}`, `second ${n}`]);
  })();
}
const snapshot = () => ({ metadata: getDb().query("SELECT * FROM tool_outputs ORDER BY id").all(), fts: getDb().query("SELECT rowid,* FROM tool_outputs_fts ORDER BY rowid").all() });

for (const count of [0, 1, 100, 101, 205]) test(`retention deletes ${count} rows across bounded FTS batches and is idempotent`, () => {
  seed(count); storeToolOutputWithChunks({ id: "live", created_at: fresh }, ["keep needle"]);
  expect(deleteToolOutputsBefore(cutoff).map(row => row.id).sort()).toEqual(Array.from({ length: count }, (_, n) => `expired-${n}`).sort());
  expect(getDb().query("SELECT id FROM tool_outputs").all()).toEqual([{ id: "live" }]);
  expect(getDb().query("SELECT content,output_id FROM tool_outputs_fts").all()).toEqual([{ content: "keep needle", output_id: "live" }]);
  expect(deleteToolOutputsBefore(cutoff)).toEqual([]);
});

test("all record validation precedes mutation and final authority validation precedes commit", () => {
  seed(3); const db = getDb(), order: string[] = [];
  const removed = deleteToolOutputsBefore(cutoff, null, () => {
    order.push("authority");
    expect(db.inTransaction).toBe(true);
    expect((db.query("SELECT count(*) n FROM tool_outputs").get() as { n: number }).n).toBe(order.length === 1 ? 3 : 0);
  }, row => { order.push(row.id); expect((db.query("SELECT count(*) n FROM tool_outputs").get() as { n: number }).n).toBe(3); });
  expect(removed).toHaveLength(3); expect(order[0]).toBe("authority"); expect(order.at(-1)).toBe("authority"); expect(order).toHaveLength(5);
});

for (const phase of ["record", "final"]) test(`${phase} validation failure rolls back metadata and FTS`, () => {
  seed(205); const before = snapshot(); let checks = 0;
  expect(() => deleteToolOutputsBefore(cutoff, null, () => { if (++checks === 2 && phase === "final") throw Error("revoked"); }, () => { if (phase === "record") throw Error("revoked"); })).toThrow("revoked");
  expect(snapshot()).toEqual(before); expect(getDb().inTransaction).toBe(false);
});

test("metadata abort and second FTS batch failure roll back all prior deletes", () => {
  seed(205); const db = getDb(), before = snapshot();
  db.run("CREATE TEMP TRIGGER fail_delete BEFORE DELETE ON tool_outputs WHEN OLD.id='expired-100' BEGIN SELECT RAISE(ABORT,'delete failure'); END");
  try { expect(() => deleteToolOutputsBefore(cutoff)).toThrow("delete failure"); expect(snapshot()).toEqual(before); }
  finally { db.run("DROP TRIGGER fail_delete"); }
  const prepare = db.prepare; let batches = 0;
  db.prepare = ((sql: string, ...args: unknown[]) => {
    if (sql.startsWith("DELETE FROM tool_outputs_fts") && ++batches === 2) throw Error("batch failure");
    return Reflect.apply(prepare, db, [sql, ...args]);
  }) as typeof db.prepare;
  try { expect(() => deleteToolOutputsBefore(cutoff)).toThrow("batch failure"); }
  finally { db.prepare = prepare; }
  expect(batches).toBe(2); expect(snapshot()).toEqual(before); expect(db.inTransaction).toBe(false);
});

test("ignored metadata deletes preserve FTS and never return authority to unlink their files", () => {
  seed(2); const db = getDb();
  db.run("CREATE TEMP TABLE ignored_observations(id TEXT)");
  db.run("CREATE TEMP TRIGGER skip_delete BEFORE DELETE ON tool_outputs WHEN OLD.id='expired-0' BEGIN INSERT INTO ignored_observations VALUES(OLD.id); SELECT RAISE(IGNORE); END");
  try {
    expect(deleteToolOutputsBefore(cutoff).map(row => row.id)).toEqual(["expired-1"]);
    expect(db.query("SELECT id FROM tool_outputs").all()).toEqual([{ id: "expired-0" }]);
    expect((db.query("SELECT count(*) n FROM tool_outputs_fts WHERE output_id='expired-0'").get() as { n: number }).n).toBe(2);
    expect(db.query("SELECT id FROM ignored_observations").all()).toEqual([{ id: "expired-0" }]);
  } finally { db.run("DROP TRIGGER skip_delete"); db.run("DROP TABLE ignored_observations"); }
});

test("metadata delete triggers observe matching FTS before later batched cleanup", () => {
  seed(3); const db = getDb();
  db.run("CREATE TEMP TABLE observations(id TEXT,n INTEGER)");
  db.run("CREATE TEMP TRIGGER observe_delete AFTER DELETE ON tool_outputs BEGIN INSERT INTO observations SELECT OLD.id,count(*) FROM tool_outputs_fts WHERE output_id=OLD.id; END");
  try { expect(deleteToolOutputsBefore(cutoff)).toHaveLength(3); expect(db.query("SELECT n FROM observations").all()).toEqual([{ n: 2 }, { n: 2 }, { n: 2 }]); }
  finally { db.run("DROP TRIGGER observe_delete"); db.run("DROP TABLE observations"); }
});

test("scoped retention preserves other roots, kinds and legacy rows", () => {
  const db = getDb();
  const makeScope = (chat: string): ToolOutputScope => {
    storeChatMetadata(chat, old, chat); const owner = assignRootOwner(db, chat, "default");
    return { ownerUserId: "default", rootBranchId: owner.rootBranchId, sourceBranchId: owner.rootBranchId, chatJid: chat, executionKind: "interactive" };
  };
  const a = makeScope("fixture:a"), b = makeScope("fixture:b");
  seed(205, a, "a"); seed(2, b, "b"); seed(2, { ...a, executionKind: "side-prompt" }, "side"); seed(2, null, "legacy");
  expect(deleteToolOutputsBefore(cutoff, a)).toHaveLength(205);
  expect(db.query("SELECT id FROM tool_outputs ORDER BY id").all()).toEqual(["b-0", "b-1", "legacy-0", "legacy-1", "side-0", "side-1"].map(id => ({ id })));
  expect((db.query("SELECT count(*) n FROM tool_outputs_fts").get() as { n: number }).n).toBe(12);
});

test("disk-WAL retention rollback, independent observer and trigger counts", async () => {
  await withTempWorkspaceEnv("retention-disk-", {}, async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", new URL("../fixtures/tool-output-retention-disk.ts", import.meta.url).pathname], {
      env: { ...process.env, PICLAW_DB_IN_MEMORY: "0", PI_OFFLINE: "1", OTEL_SDK_DISABLED: "true" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, stderr).toBe(0);
      expect(JSON.parse(stdout.split("\n").find(line => line.startsWith('{"status"'))!)).toEqual({ status: "pass", rollback: true, secondConnection: true, triggerCounts: true, idempotent: true });
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
  });
}, 25_000);
