import type Database from "bun:sqlite";

/** Delete expired or orphaned transient auth state. No factor, account or audit deletion. */
export function pruneExpiredAuthState(database: Database, now = Date.now()): Record<string, number> {
  if (!Number.isFinite(now)) throw new Error("Invalid authentication cleanup clock.");
  return database.transaction(() => {
    const counts: Record<string, number> = {};
    const iso = new Date(now).toISOString();
    counts.sessions = database.query("DELETE FROM web_sessions WHERE julianday(expires_at) IS NULL OR julianday(expires_at)<=julianday(?)").run(iso).changes;
    counts.invitations = database.query(`DELETE FROM user_auth_invitations WHERE expires_at<=?
      OR NOT EXISTS (SELECT 1 FROM users WHERE id=user_auth_invitations.user_id)
      OR (recovery_event_id IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id=user_auth_invitations.issuer_user_id AND enabled=1 AND role='admin'))
      OR (recovery_event_id IS NOT NULL AND (issuer_user_id<>user_id
        OR NOT EXISTS (SELECT 1 FROM users WHERE id=user_auth_invitations.user_id AND role='admin')
        OR NOT EXISTS (SELECT 1 FROM operator_recovery_events e WHERE e.id=user_auth_invitations.recovery_event_id
          AND e.target_user_id=user_auth_invitations.user_id AND e.method=user_auth_invitations.method AND e.origin=user_auth_invitations.expected_origin)))`).run(now).changes;
    counts.totpEnrolments = database.query("DELETE FROM user_totp_enrolments WHERE expires_at<=? OR NOT EXISTS (SELECT 1 FROM users WHERE id=user_totp_enrolments.user_id)").run(now).changes;
    counts.totpRegistrations = database.query(`DELETE FROM user_totp_registrations WHERE expires_at<=?
      OR NOT EXISTS (SELECT 1 FROM users WHERE id=user_totp_registrations.user_id AND enabled=1)
      OR NOT EXISTS (SELECT 1 FROM web_sessions WHERE session_id=user_totp_registrations.session_id AND user_id=user_totp_registrations.user_id)`).run(now).changes;
    counts.passkeyRegistrations = database.query(`DELETE FROM user_passkey_registrations WHERE expires_at<=?
      OR NOT EXISTS (SELECT 1 FROM users WHERE id=user_passkey_registrations.user_id AND enabled=1)
      OR NOT EXISTS (SELECT 1 FROM web_sessions WHERE session_id=user_passkey_registrations.session_id AND user_id=user_passkey_registrations.user_id)`).run(now).changes;
    counts.legacyEnrolments = database.query("DELETE FROM webauthn_enrollments WHERE julianday(expires_at) IS NULL OR julianday(expires_at)<=julianday(?)").run(iso).changes;
    counts.attempts = database.query("DELETE FROM user_auth_attempts WHERE reset_at<=?").run(now).changes;
    return counts;
  }).immediate();
}
