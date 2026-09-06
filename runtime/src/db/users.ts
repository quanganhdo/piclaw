import type Database from "bun:sqlite";

import { createUuid } from "../utils/ids.js";

export type UserRole = "admin" | "member";

export interface UserRecord {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  enabled: boolean;
  home_chat_jid: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  role?: UserRole;
}

export interface UpdateUserInput {
  username?: string;
  displayName?: string;
  role?: UserRole;
  enabled?: boolean;
}

type UserRow = Omit<UserRecord, "enabled"> & { enabled: number };

const USER_COLUMNS = `id, username, display_name, role, enabled, home_chat_jid, created_at, updated_at`;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED_USERNAMES = new Set(["default", "admin", "system", "service", "anonymous"]);
const CREATE_FIELDS = new Set(["username", "displayName", "role"]);
const UPDATE_FIELDS = new Set(["username", "displayName", "role", "enabled"]);

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${label} contains unsupported field: ${unknown[0]}.`);
}

function normalizeUsername(value: unknown): string {
  if (typeof value !== "string") throw new Error("Username must be a string.");
  const username = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error("Username must match [a-z0-9][a-z0-9_-]{0,63}.");
  }
  return username;
}

function assertPublicUsername(username: string, existingUsername?: string): void {
  if (RESERVED_USERNAMES.has(username) && username !== existingUsername?.trim().toLowerCase()) {
    throw new Error(`Username is reserved: ${username}.`);
  }
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Display name must be a string.");
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) {
    throw new Error("Display name must not contain control characters or newlines.");
  }
  const displayName = value.trim();
  if (displayName.length === 0) throw new Error("Display name must not be empty.");
  if (Array.from(displayName).length > 128) throw new Error("Display name must not exceed 128 characters.");
  return displayName;
}

function normalizeRole(value: unknown): UserRole {
  if (value !== "admin" && value !== "member") throw new Error("Role must be either admin or member.");
  return value;
}

function toUserRecord(row: UserRow | undefined): UserRecord | null {
  if (!row) return null;
  return { ...row, enabled: row.enabled !== 0 };
}

/** Add the users schema and seed the legacy single-user identity without changing existing rows. */
export function initializeUserSchema(database: Database, legacyDisplayName = "User"): void {
  const displayName = normalizeDisplayName(legacyDisplayName);
  const install = () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        home_chat_jid TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase
        ON users(username COLLATE NOCASE);
    `);

    const now = new Date().toISOString();
    database.query(`
      INSERT INTO users (
        id, username, display_name, role, enabled, home_chat_jid, created_at, updated_at
      ) VALUES ('default', 'default', ?, 'admin', 1, 'web:default', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(displayName, now, now);
  };

  if (database.inTransaction) install();
  else database.transaction(install).immediate();
}

/** Provision a disabled user. Home-chat assignment and activation happen separately. */
export function createUser(database: Database, input: CreateUserInput): UserRecord {
  assertObject(input, "User input");
  rejectUnknownFields(input, CREATE_FIELDS, "User input");
  const username = normalizeUsername(input.username);
  assertPublicUsername(username);
  const displayName = normalizeDisplayName(input.displayName);
  const role = input.role === undefined ? "member" : normalizeRole(input.role);
  const id = createUuid("user");
  const now = new Date().toISOString();

  database.query(`
    INSERT INTO users (
      id, username, display_name, role, enabled, home_chat_jid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
  `).run(id, username, displayName, role, now, now);
  return getUser(database, id)!;
}

export function getUser(database: Database, id: string): UserRecord | null {
  const row = database.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return toUserRecord(row);
}

export function listUsers(database: Database): UserRecord[] {
  const rows = database.query(`
    SELECT ${USER_COLUMNS} FROM users
    ORDER BY username COLLATE NOCASE ASC, id ASC
  `).all() as UserRow[];
  return rows.map((row) => toUserRecord(row)!);
}

/** Update public user fields while preserving identity and home-chat ownership. */
export function updateUser(database: Database, id: string, patch: UpdateUserInput): UserRecord | null {
  assertObject(patch, "User patch");
  rejectUnknownFields(patch, UPDATE_FIELDS, "User patch");

  const run = () => {
    const current = getUser(database, id);
    if (!current) return null;

    const assignments: string[] = [];
    const values: Array<string | number> = [];
    let nextRole = current.role;
    let nextEnabled = current.enabled;

    if (patch.username !== undefined) {
      const username = normalizeUsername(patch.username);
      assertPublicUsername(username, current.username);
      assignments.push("username = ?");
      values.push(username);
    }
    if (patch.displayName !== undefined) {
      assignments.push("display_name = ?");
      values.push(normalizeDisplayName(patch.displayName));
    }
    if (patch.role !== undefined) {
      nextRole = normalizeRole(patch.role);
      assignments.push("role = ?");
      values.push(nextRole);
    }
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== "boolean") throw new Error("Enabled must be a boolean.");
      nextEnabled = patch.enabled;
      assignments.push("enabled = ?");
      values.push(nextEnabled ? 1 : 0);
    }

    const removesEnabledAdmin = current.enabled && current.role === "admin"
      && (!nextEnabled || nextRole !== "admin");
    if (removesEnabledAdmin) {
      const row = database.query(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND enabled = 1",
      ).get() as { count: number };
      if (row.count <= 1) throw new Error("Cannot disable or demote the last enabled admin.");
    }

    if (assignments.length === 0) return current;
    assignments.push("updated_at = ?");
    values.push(new Date().toISOString(), id);
    database.query(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
    return getUser(database, id);
  };

  if (database.inTransaction) return run();
  return database.transaction(run).immediate();
}
