import type Database from "bun:sqlite";

/** Delete expired single-user sessions and legacy WebAuthn enrolments.
 * Preserve factors, accounts, audits and retired per-account registration tables. */
export function pruneExpiredAuthState(database: Database, now = Date.now()): Record<string, number> {
  if (!Number.isFinite(now)) throw new Error("Invalid authentication cleanup clock.");
  return database.transaction(() => {
    const counts: Record<string, number> = {};
    const iso = new Date(now).toISOString();
    counts.sessions = database.query("DELETE FROM web_sessions WHERE julianday(expires_at) IS NULL OR julianday(expires_at)<=julianday(?)").run(iso).changes;
    counts.legacyEnrolments = database.query("DELETE FROM webauthn_enrollments WHERE julianday(expires_at) IS NULL OR julianday(expires_at)<=julianday(?)").run(iso).changes;
    return counts;
  }).immediate();
}
