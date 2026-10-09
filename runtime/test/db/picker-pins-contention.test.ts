import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { changePickerPins, initializePickerPins, readPickerPins } from "../../src/db/picker-pins.js";

test("existing picker scope reads through a writer lock without any write", () => {
  const ws = createTempWorkspace("picker-read-contention-");
  const path = join(ws.base, "pins.db");
  const db = new Database(path);
  const blocker = new Database(path);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=40");
    initializePickerPins(db);
    changePickerPins(db, "owner", { action: "set", kind: "model", key: "test/one", pinned: true });
    changePickerPins(db, "owner", { action: "set", kind: "session", key: "web:visible", pinned: true });
    changePickerPins(db, "owner", { action: "set", kind: "session", key: "web:hidden", pinned: true });
    const before = readPickerPins(db, "owner", jid => jid !== "web:hidden");
    const changes = db.query("SELECT total_changes() n").get();
    blocker.exec("BEGIN IMMEDIATE");
    try {
      expect(readPickerPins(db, "owner", jid => jid !== "web:hidden")).toEqual(before);
      expect(db.query("SELECT total_changes() n").get()).toEqual(changes);
      expect(() => readPickerPins(db, "new-owner")).toThrow();
      expect(db.query("SELECT public_id FROM picker_pin_scopes WHERE owner='new-owner'").get()).toBeNull();
    } finally { blocker.exec("ROLLBACK"); }
    const created = readPickerPins(db, "new-owner");
    expect(created.scope).not.toBe(before.scope);
    expect(readPickerPins(db, "new-owner")).toEqual(created);
  } finally { blocker.close(); db.close(); ws.cleanup(); }
});

test("read-only database reopen retains opaque scope and filters without writes", () => {
  const ws = createTempWorkspace("picker-readonly-");
  const path = join(ws.base, "pins.db");
  let db = new Database(path);
  try {
    initializePickerPins(db);
    const first = changePickerPins(db, "owner", { action: "import", browser: "browser-persistence-00", models: ["test/keep", "test/unpin"], sessions: ["web:owned"] });
    const before = changePickerPins(db, "owner", { action: "set", kind: "model", key: "test/unpin", pinned: false });
    db.close(); db = new Database(path, { readonly: true });
    expect(readPickerPins(db, "owner")).toEqual(before);
    expect(readPickerPins(db, "owner").scope).toBe(first.scope);
    expect(readPickerPins(db, "owner", () => false).sessions).toEqual([]);
    expect(db.query("SELECT total_changes() n").get()).toEqual({ n: 0 });
    expect(() => readPickerPins(db, "missing")).toThrow();
    db.close(); db = new Database(path);
    const replayed = changePickerPins(db, "owner", { action: "import", browser: "browser-other-000000", models: ["test/unpin", "test/new"], sessions: [] });
    expect(replayed.scope).toBe(first.scope);
    expect(replayed.models).toEqual(["test/keep", "test/new"]);
  } finally { db.close(); ws.cleanup(); }
});
