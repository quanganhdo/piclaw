import Database from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createUser, getUser, initializeUserSchema, listUsers, updateUser } from "../../src/db/users.js";

let database: Database;

beforeEach(() => {
  database = new Database(":memory:");
  initializeUserSchema(database);
});

afterEach(() => database.close());

describe("initializeUserSchema", () => {
  test("creates the default enabled admin", () => {
    expect(getUser(database, "default")).toEqual({
      id: "default",
      username: "default",
      display_name: "User",
      role: "admin",
      enabled: true,
      home_chat_jid: "web:default",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  test("is idempotent and never overwrites default-user fields", () => {
    database.query(`
      UPDATE users SET username = 'owner', display_name = 'Existing Owner', role = 'member',
        enabled = 0, home_chat_jid = 'web:owner', updated_at = 'kept' WHERE id = 'default'
    `).run();
    initializeUserSchema(database, "Replacement");
    expect(getUser(database, "default")).toEqual(expect.objectContaining({
      username: "owner",
      display_name: "Existing Owner",
      role: "member",
      enabled: false,
      home_chat_jid: "web:owner",
      updated_at: "kept",
    }));
    expect(listUsers(database)).toHaveLength(1);
  });

  test("uses a trimmed legacy display name when first seeding", () => {
    const isolated = new Database(":memory:");
    try {
      initializeUserSchema(isolated, "  Legacy Owner  ");
      expect(getUser(isolated, "default")?.display_name).toBe("Legacy Owner");
    } finally {
      isolated.close();
    }
  });
});

describe("createUser", () => {
  test("normalizes identity and provisions a disabled user without a home chat", () => {
    const user = createUser(database, { username: "  Alice_Smith  ", displayName: "  Alice Smith  " });
    expect(user).toEqual({
      id: expect.stringMatching(/^user-[0-9a-f-]{36}$/),
      username: "alice_smith",
      display_name: "Alice Smith",
      role: "member",
      enabled: false,
      home_chat_jid: null,
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(getUser(database, user.id)).toEqual(user);
  });

  test("accepts an explicit admin role", () => {
    expect(createUser(database, {
      username: "backup-admin",
      displayName: "Backup Admin",
      role: "admin",
    }).role).toBe("admin");
  });

  test.each(["default", "ADMIN", " system ", "service", "anonymous"])(
    "rejects reserved username %s",
    (username) => expect(() => createUser(database, { username, displayName: "Reserved" })).toThrow(/reserved/i),
  );

  test.each(["", "-alice", "alice!", "álîce", "a".repeat(65)])(
    "rejects invalid username %s",
    (username) => expect(() => createUser(database, { username, displayName: "Alice" })).toThrow(/username/i),
  );

  test("enforces case-insensitive uniqueness even for disabled users", () => {
    createUser(database, { username: "alice", displayName: "Alice" });
    expect(() => createUser(database, { username: "ALICE", displayName: "Other Alice" })).toThrow();
  });

  test.each(["   ", "Line\nBreak", "\nAlice", "Alice\t", "Alice\u2028Smith", `x${String.fromCharCode(0)}y`, "x".repeat(129)])(
    "rejects invalid display names",
    (displayName) => {
      const username = `user-${Math.random().toString(36).slice(2)}`;
      expect(() => createUser(database, { username, displayName })).toThrow(/display name/i);
    },
  );
});

describe("getUser and listUsers", () => {
  test("returns null for an unknown id and boolean enabled values", () => {
    expect(getUser(database, "missing")).toBeNull();
    expect(listUsers(database).map((user) => user.enabled)).toEqual([true]);
  });

  test("lists users in normalized username order", () => {
    createUser(database, { username: "zoe", displayName: "Zoe" });
    createUser(database, { username: "alice", displayName: "Alice" });
    expect(listUsers(database).map((user) => user.username)).toEqual(["alice", "default", "zoe"]);
  });
});

describe("updateUser", () => {
  test("updates supported fields and permits activation before home assignment", () => {
    const user = createUser(database, { username: "alice", displayName: "Alice" });
    const updated = updateUser(database, user.id, {
      username: "  Alice-2 ", displayName: "  Alice Two  ", role: "admin", enabled: true,
    });
    expect(updated).toEqual(expect.objectContaining({
      id: user.id,
      username: "alice-2",
      display_name: "Alice Two",
      role: "admin",
      enabled: true,
      home_chat_jid: null,
      created_at: user.created_at,
    }));
  });

  test("returns null for a missing user", () => {
    expect(updateUser(database, "missing", { displayName: "Nobody" })).toBeNull();
  });

  test("rejects unknown, id, and home_chat_jid patch fields", () => {
    for (const patch of [{ nickname: "Ali" }, { id: "replacement" }, { home_chat_jid: "web:replacement" }]) {
      expect(() => updateUser(database, "default", patch as never)).toThrow(/unsupported field/i);
    }
  });

  test("rejects invalid patch values", () => {
    const user = createUser(database, { username: "alice", displayName: "Alice" });
    expect(() => updateUser(database, user.id, { username: "bad name" })).toThrow(/username/i);
    expect(() => updateUser(database, user.id, { displayName: "bad\nname" })).toThrow(/display name/i);
    expect(() => updateUser(database, user.id, { role: "owner" as never })).toThrow(/role/i);
    expect(() => updateUser(database, user.id, { enabled: 1 as never })).toThrow(/boolean/i);
  });

  test("rejects reserved renames but allows an existing reserved username to be kept", () => {
    const user = createUser(database, { username: "alice", displayName: "Alice" });
    expect(() => updateUser(database, user.id, { username: "admin" })).toThrow(/reserved/i);
    expect(updateUser(database, "default", { username: " DEFAULT ", displayName: "Primary User" }))
      .toEqual(expect.objectContaining({ username: "default", display_name: "Primary User" }));
  });

  test("retains case-insensitive uniqueness on rename", () => {
    createUser(database, { username: "alice", displayName: "Alice" });
    const bob = createUser(database, { username: "bob", displayName: "Bob" });
    expect(() => updateUser(database, bob.id, { username: "ALICE" })).toThrow();
  });

  test("cannot disable or demote the last enabled admin", () => {
    expect(() => updateUser(database, "default", { enabled: false })).toThrow(/last enabled admin/i);
    expect(() => updateUser(database, "default", { role: "member" })).toThrow(/last enabled admin/i);
    expect(getUser(database, "default")).toEqual(expect.objectContaining({ role: "admin", enabled: true }));
  });

  test("can remove one admin when another enabled admin exists", () => {
    const backup = createUser(database, { username: "backup", displayName: "Backup", role: "admin" });
    updateUser(database, backup.id, { enabled: true });
    expect(updateUser(database, "default", { enabled: false })).toEqual(expect.objectContaining({ enabled: false }));
    expect(() => updateUser(database, backup.id, { role: "member" })).toThrow(/last enabled admin/i);
  });

  test("rolls back all patch fields when last-admin protection rejects the update", () => {
    expect(() => updateUser(database, "default", { displayName: "Should Roll Back", role: "member" }))
      .toThrow(/last enabled admin/i);
    expect(getUser(database, "default")?.display_name).toBe("User");
  });
});
