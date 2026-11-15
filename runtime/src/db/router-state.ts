/**
 * db/router-state.ts – Key-value persistence for the message router.
 *
 * Stores per-chat cursor timestamps (high-water marks) so the router knows
 * which messages have already been processed across restarts.
 *
 * The underlying table (`router_state`) is a simple key→value store; the
 * router uses keys like `cursor:<chatJid>` to track the last-seen timestamp.
 *
 * Consumers:
 *   - router.ts reads/writes cursor positions each poll cycle.
 */

import { getDb } from "./connection.js";

/** Retrieve a single router state value by key. Returns undefined if not set. */
export function getRouterState(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare("SELECT value FROM router_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/** Insert or replace a router state key-value pair. */
export function setRouterState(key: string, value: string): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)").run(key, value);
}

/** Remove a router state entry. */
export function deleteRouterState(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM router_state WHERE key = ?").run(key);
}
