import { afterEach, describe, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EARENDIL_SQLITE_COMPATIBILITY_COMMIT, SqliteSessionStore } from "../../scripts/lib/sqlite-session-archive.js";

let cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piclaw-sqlite-session-"));
  cleanup.push(root);
  const source = join(root, "session.jsonl");
  const lines = [
    { type: "session", version: 3, id: "session-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" },
    { type: "message", id: "user-1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "old" } },
    { type: "message", id: "assistant-1", parentId: "user-1", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "old answer" }] } },
    { type: "message", id: "keep-1", parentId: "assistant-1", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "user", content: "needle current" } },
    { type: "compaction", id: "compact-1", parentId: "keep-1", timestamp: "2026-01-01T00:00:04.000Z", summary: "summary", firstKeptEntryId: "keep-1", tokensBefore: 10 },
    { type: "message", id: "assistant-2", parentId: "compact-1", timestamp: "2026-01-01T00:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "needle answer" }] } },
  ];
  writeFileSync(source, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return { root, source, database: join(root, "sessions.db") };
}

describe("archival SqliteSessionStore", () => {
  test("retains the exact historical owner, migration identity and SQL checksum", () => {
    const { database } = fixture();
    const store = new SqliteSessionStore(database);
    try {
      expect(store.database.query("SELECT owner,id,migration_order,checksum FROM piclaw_schema_migrations").all()).toEqual([{
        owner:"piclaw-agent-sessions",id:"001-namespaced-session-import",migration_order:1,
        checksum:"3e4099241ba82d20d6ddfd41b12dc0f4d8c04cfa622bea2f0578300301811e72",
      }]);
    } finally { store.close(); }
  });

  test("pins the non-shipping Earendil main compatibility probe", () => {
    expect(EARENDIL_SQLITE_COMPATIBILITY_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  test("imports without modifying JSONL and exports byte-identical content", async () => {
    const { source, database } = fixture();
    const before = readFileSync(source);
    const beforeStat = statSync(source);
    const store = new SqliteSessionStore(database);
    try {
      const result = await store.importJsonl(source);
      expect(result.imported).toBe(true);
      expect(result.entryCount).toBe(5);
      expect(store.verifyRoundTrip(result.importId)).toEqual({
        sha256: createHash("sha256").update(before).digest("hex"),
        bytes: before.length,
        matches: true,
      });
      expect(Buffer.from(store.exportJsonl(result.importId))).toEqual(before);
      expect(readFileSync(source)).toEqual(before);
      expect(statSync(source).mtimeMs).toBe(beforeStat.mtimeMs);
      expect((await store.importJsonl(source)).imported).toBe(false);
    } finally {
      store.close();
    }
  });

  test("reconstructs branches, compaction windows and identified FTS results", async () => {
    const { source, database } = fixture();
    const store = new SqliteSessionStore(database);
    try {
      const result = await store.importJsonl(source);
      expect(store.readBranch(result.importId).map((entry) => entry.entry_id)).toEqual([
        "user-1", "assistant-1", "keep-1", "compact-1", "assistant-2",
      ]);
      expect(store.readCompactedBranch(result.importId).map((entry) => entry.entry_id)).toEqual([
        "keep-1", "compact-1", "assistant-2",
      ]);
      const hits = store.search("needle answer");
      expect(hits.map((entry) => entry.entry_id)).toEqual(["assistant-2"]);
      expect(hits[0]?.import_id).toBe(result.importId);
      expect(hits[0]?.session_id).toBe("session-1");
      expect(hits[0]?.source_path).toBe(source);
    } finally {
      store.close();
    }
  });

  test("rolls back a malformed import and preserves an existing changed source", async () => {
    const { root, source, database } = fixture();
    const malformed = join(root, "malformed.jsonl");
    writeFileSync(malformed, `${JSON.stringify({ type: "session", version: 3, id: "bad", cwd: "/workspace" })}\n{invalid}\n`);
    const store = new SqliteSessionStore(database);
    try {
      await expect(store.importJsonl(malformed)).rejects.toThrow();
      const count = store.database.prepare("SELECT COUNT(*) AS count FROM piclaw_agent_sessions").get() as { count: number };
      expect(count.count).toBe(0);
      const imported = await store.importJsonl(source);
      writeFileSync(source, `${readFileSync(source, "utf8").trimEnd()}\n${JSON.stringify({ type: "message", id: "changed", parentId: "assistant-2", message: { role: "user", content: "changed" } })}\n`);
      await expect(store.importJsonl(source)).rejects.toThrow("existing rows were preserved");
      expect(store.verifyRoundTrip(imported.importId).matches).toBe(true);
    } finally {
      store.close();
    }
  });

  test("terminates branch reconstruction when legacy parent links contain a cycle", async () => {
    const { root, database } = fixture();
    const cyclic = join(root, "cyclic.jsonl");
    writeFileSync(cyclic, [
      JSON.stringify({ type: "session", version: 3, id: "cyclic", cwd: "/workspace" }),
      JSON.stringify({ type: "message", id: "a", parentId: "b", message: { role: "user", content: "a" } }),
      JSON.stringify({ type: "message", id: "b", parentId: "a", message: { role: "assistant", content: "b" } }),
      "",
    ].join("\n"));
    const store = new SqliteSessionStore(database);
    try {
      const imported = await store.importJsonl(cyclic);
      expect(store.readBranch(imported.importId).map((entry) => entry.entry_id)).toEqual(["a", "b"]);
    } finally {
      store.close();
    }
  });

  test("rejects an unowned incompatible session schema", () => {
    const { database } = fixture();
    const drifted = new Database(database, { create: true, strict: true });
    drifted.exec("CREATE TABLE piclaw_agent_sessions(id TEXT PRIMARY KEY)");
    drifted.close();
    expect(() => new SqliteSessionStore(database)).toThrow("Unowned session schema objects");
  });

  test("rolls back SQL failures after the import transaction begins", async () => {
    const { root, database } = fixture();
    const duplicate = join(root, "duplicate.jsonl");
    writeFileSync(duplicate, [
      JSON.stringify({ type: "session", version: 3, id: "duplicate", cwd: "/workspace" }),
      JSON.stringify({ type: "message", id: "same", parentId: null, message: { role: "user", content: "one" } }),
      JSON.stringify({ type: "message", id: "same", parentId: "same", message: { role: "assistant", content: "two" } }),
      "",
    ].join("\n"));
    const store = new SqliteSessionStore(database);
    try {
      await expect(store.importJsonl(duplicate)).rejects.toThrow();
      expect((store.database.prepare("SELECT COUNT(*) AS count FROM piclaw_agent_sessions").get() as { count: number }).count).toBe(0);
      expect((store.database.prepare("SELECT COUNT(*) AS count FROM piclaw_agent_entries").get() as { count: number }).count).toBe(0);
    } finally {
      store.close();
    }
  });

  test("coexists with existing timeline tables in a unified database", async () => {
    const { source, database } = fixture();
    const timeline = new Database(database, { create: true, strict: true });
    timeline.exec("CREATE TABLE messages(id TEXT PRIMARY KEY, content TEXT); INSERT INTO messages VALUES ('m1', 'preserve me');");
    timeline.close();
    const store = new SqliteSessionStore(database);
    try {
      await store.importJsonl(source);
      const message = store.database.prepare("SELECT content FROM messages WHERE id = 'm1'").get() as { content: string };
      expect(message.content).toBe("preserve me");
      const names = (store.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
      expect(names).toContain("messages");
      expect(names).toContain("piclaw_agent_sessions");
    } finally {
      store.close();
    }
    expect(existsSync(database)).toBe(true);
  });
});
