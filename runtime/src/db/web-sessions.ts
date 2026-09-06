/**
 * db/web-sessions.ts – Persistent web UI auth session storage.
 *
 * Stores session tokens issued after TOTP or passkey login so sessions
 * survive restarts. Tokens are persisted as SHA-256 hashes (not plaintext)
 * for at-rest hardening. Designed for a single-user default now, but includes
 * user_id to enable multi-user support later without schema changes.
 */

import { createHash } from "node:crypto";
import { createUuid } from "../utils/ids.js";
import { getDb } from "./connection.js";

/** Default user ID used for single-user web auth sessions. */
export const DEFAULT_WEB_USER_ID = "default";

/** Persisted web auth session row. */
export interface WebSessionRecord {
  token: string;
  session_id?: string;
  user_id: string;
  auth_method: string | null;
  created_at: string;
  expires_at: string;
}

/** Derive a deterministic DB-safe hash for a session token. */
function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Create or replace a persistent web auth session token row. */
export function createWebSession(
  token: string,
  userId: string,
  ttlSeconds: number,
  authMethod: string | null
): WebSessionRecord {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const tokenHash = hashSessionToken(token);
  const sessionId = createUuid("login");
  db.prepare(
    "INSERT OR REPLACE INTO web_sessions (token, user_id, auth_method, created_at, expires_at, session_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(tokenHash, userId, authMethod, createdAt, expiresAt, sessionId);
  return { token, session_id: sessionId, user_id: userId, auth_method: authMethod, created_at: createdAt, expires_at: expiresAt };
}

/** Fetch a session row by token and auto-delete it when expired. */
export function getWebSession(token: string): WebSessionRecord | null {
  const db = getDb();
  const tokenHash = hashSessionToken(token);

  let row = db
    .prepare("SELECT token, user_id, auth_method, created_at, expires_at, session_id FROM web_sessions WHERE token = ?")
    .get(tokenHash) as WebSessionRecord | undefined;

  // Legacy fallback for plain-token rows created before hashing hardening.
  if (!row) {
    row = db
      .prepare("SELECT token, user_id, auth_method, created_at, expires_at, session_id FROM web_sessions WHERE token = ?")
      .get(token) as WebSessionRecord | undefined;

    if (row) {
      // Update the key in one statement, preserving identity if the process stops mid-migration.
      db.prepare("UPDATE web_sessions SET token = ? WHERE token = ?").run(tokenHash, token);
    }
  }

  if (!row) return null;

  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    db.prepare("DELETE FROM web_sessions WHERE token = ?").run(tokenHash);
    db.prepare("DELETE FROM web_sessions WHERE token = ?").run(token);
    return null;
  }

  if (!row.session_id) {
    const sessionId = createUuid("login");
    db.prepare("UPDATE web_sessions SET session_id = ? WHERE token = ? AND session_id IS NULL").run(sessionId, tokenHash);
    row.session_id = (db.prepare("SELECT session_id FROM web_sessions WHERE token = ?").get(tokenHash) as { session_id: string }).session_id;
  }
  return {
    token,
    session_id: row.session_id,
    user_id: row.user_id,
    auth_method: row.auth_method,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

/** List device sessions without exposing bearer tokens or their stored hashes. */
export function listUserWebSessions(userId: string): Array<Omit<WebSessionRecord, "token">> {
  return getDb().prepare(
    "SELECT session_id, user_id, auth_method, created_at, expires_at FROM web_sessions WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as Array<Omit<WebSessionRecord, "token">>;
}

/** Revoke only a login belonging to the authorised target user; caller enforces actor permissions. */
export function revokeUserWebSession(userId: string, sessionId: string): boolean {
  return getDb().prepare("DELETE FROM web_sessions WHERE user_id = ? AND session_id = ?").run(userId, sessionId).changes > 0;
}

/** Account reset can revoke all its cookies without disturbing other accounts. */
export function revokeUserWebSessions(userId: string): number {
  return getDb().prepare("DELETE FROM web_sessions WHERE user_id = ?").run(userId).changes;
}

/** Delete expired session rows and return number of removed records. */
export function deleteExpiredWebSessions(now = new Date()): number {
  const db = getDb();
  const nowIso = now.toISOString();
  const info = db.prepare("DELETE FROM web_sessions WHERE expires_at <= ?").run(nowIso);
  return Number(info.changes || 0);
}

/** Delete all web auth sessions and return number of removed records. */
export function deleteAllWebSessions(): number {
  const db = getDb();
  const info = db.prepare("DELETE FROM web_sessions").run();
  return Number(info.changes || 0);
}
