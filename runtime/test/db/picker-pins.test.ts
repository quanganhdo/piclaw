import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  initializePickerPins,
  readPickerPins,
  changePickerPins,
  parsePinChange,
} from "../../src/db/picker-pins";
function database() {
  const db = new Database(":memory:");
  initializePickerPins(db);
  return db;
}
test("scope isolation, independent desired-state edits and idempotence", () => {
  const db = database();
  try {
    const a = readPickerPins(db, "user:a"),
      b = readPickerPins(db, "user:b");
    expect(a.scope).not.toBe(b.scope);
    changePickerPins(db, "user:a", {
      action: "set",
      kind: "model",
      key: "test/one",
      pinned: true,
    });
    const second = changePickerPins(db, "user:a", {
      action: "set",
      kind: "model",
      key: "test/two",
      pinned: true,
    });
    expect(second.models).toEqual(["test/one", "test/two"]);
    changePickerPins(db, "user:a", {
      action: "set",
      kind: "model",
      key: "test/one",
      pinned: true,
    });
    expect(readPickerPins(db, "user:a").models).toEqual(second.models);
    expect(readPickerPins(db, "user:b").models).toEqual([]);
    expect(readPickerPins(db, "operator").models).toEqual([]);
  } finally {
    db.close();
  }
});
test("one-time imports merge new pins but never revive tombstones from a stale browser", () => {
  const db = database();
  try {
    const imported = {
      action: "import" as const,
      browser: "browser-one-000000",
      models: ["test/a"],
      sessions: ["web:a"],
    };
    changePickerPins(db, "operator", imported);
    changePickerPins(db, "operator", {
      action: "set",
      kind: "model",
      key: "test/a",
      pinned: false,
    });
    changePickerPins(db, "operator", {
      action: "set",
      kind: "session",
      key: "web:a",
      pinned: false,
    });
    expect(
      changePickerPins(db, "operator", { ...imported, models: ["test/b"] })
        .models,
    ).toEqual([]);
    const next = changePickerPins(db, "operator", {
      ...imported,
      browser: "browser-two-000000",
      models: ["test/a", "test/c"],
    });
    expect(next.models).toEqual(["test/c"]);
    expect(next.sessions).toEqual([]);
    expect(
      changePickerPins(db, "operator", {
        action: "set",
        kind: "model",
        key: "test/a",
        pinned: true,
      }).models,
    ).toContain("test/a");
  } finally {
    db.close();
  }
});
test("unpin before any import creates a tombstone; session reads are reauthorised", () => {
  const db = database();
  try {
    changePickerPins(db, "user:a", {
      action: "set",
      kind: "session",
      key: "web:a",
      pinned: false,
    });
    const state = changePickerPins(
      db,
      "user:a",
      {
        action: "import",
        browser: "browser-stale-0000",
        models: [],
        sessions: ["web:a", "web:other", "web:owned"],
      },
      (jid) => jid !== "web:other",
    );
    expect(state.sessions).toEqual(["web:owned"]);
    expect(readPickerPins(db, "user:a", () => false).sessions).toEqual([]);
    expect(() =>
      changePickerPins(
        db,
        "user:a",
        { action: "set", kind: "session", key: "web:other", pinned: true },
        () => false,
      ),
    ).toThrow("Session access denied");
  } finally {
    db.close();
  }
});
test("strict bounded action parsing and model-key normalisation", () => {
  expect(
    parsePinChange({
      action: "set",
      kind: "model",
      key: " TEST/Model ",
      pinned: true,
    }),
  ).toEqual({ action: "set", kind: "model", key: "test/Model", pinned: true });
  for (const data of [
    { action: "set", kind: "model", key: "x", pinned: true },
    {
      action: "set",
      kind: "session",
      key: "web:a",
      pinned: true,
      user: "other",
    },
    { action: "import", browser: "x", models: [], sessions: [] },
    {
      action: "import",
      browser: "browser-0000000000",
      models: Array(257).fill("test/a"),
      sessions: [],
    },
  ])
    expect(() => parsePinChange(data)).toThrow();
});
test("transaction rollback preserves state when pin limit is exceeded", () => {
  const db = database();
  try {
    changePickerPins(db, "operator", {
      action: "import",
      browser: "browser-limit-0000",
      models: Array.from({ length: 256 }, (_, i) => "test/" + i),
      sessions: [],
    });
    const before = readPickerPins(db, "operator");
    expect(() =>
      changePickerPins(db, "operator", {
        action: "set",
        kind: "model",
        key: "test/extra",
        pinned: true,
      }),
    ).toThrow("Pin limit");
    expect(readPickerPins(db, "operator")).toEqual(before);
  } finally {
    db.close();
  }
});

test("database reopen preserves scope, pins, migration receipts and tombstones", async () => {
  const { createTempWorkspace } = await import("../helpers");
  const ws = createTempWorkspace("pins-persistence-");
  const path = ws.base + "/pins.db";
  let db = new Database(path);
  try {
    initializePickerPins(db);
    const first = changePickerPins(db, "operator", {
      action: "import",
      browser: "persistent-browser-000",
      models: ["test/a"],
      sessions: [],
    });
    changePickerPins(db, "operator", {
      action: "set",
      kind: "model",
      key: "test/a",
      pinned: false,
    });
    db.close();
    db = new Database(path);
    initializePickerPins(db);
    const next = changePickerPins(db, "operator", {
      action: "import",
      browser: "different-browser-000",
      models: ["test/a", "test/b"],
      sessions: [],
    });
    expect(next.scope).toBe(first.scope);
    expect(next.models).toEqual(["test/b"]);
  } finally {
    db.close();
    ws.cleanup();
  }
});
