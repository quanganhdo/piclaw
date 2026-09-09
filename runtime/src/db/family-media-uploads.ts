import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { requireAccountActor } from "./account-administration.js";
import { ChatAccessDenied } from "./session-ownership.js";

const MAX_PENDING_UPLOADS_PER_OWNER = 32;
const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000;

export function initializeFamilyMediaUploads(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_media_uploads (
    media_id INTEGER PRIMARY KEY REFERENCES media(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    login_session_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_family_media_uploads_owner_created
    ON family_media_uploads(owner_user_id,created_at,media_id);
  CREATE TRIGGER IF NOT EXISTS family_media_upload_identity_immutable
    BEFORE UPDATE ON family_media_uploads
    BEGIN SELECT RAISE(ABORT,'Family media upload identity is immutable'); END;`);
}

/** Remove only expired, unattached pending blobs before admitting another upload. */
export function pruneExpiredFamilyMediaUploads(database: Database, now = Date.now()): number {
  const cutoff = new Date(now - PENDING_UPLOAD_TTL_MS).toISOString();
  const rows = database.query(`SELECT u.media_id FROM family_media_uploads u
    WHERE u.created_at<? AND NOT EXISTS(SELECT 1 FROM message_media mm WHERE mm.media_id=u.media_id)
    ORDER BY u.created_at,u.media_id LIMIT 100`).all(cutoff) as { media_id: number }[];
  if (!rows.length) return 0;
  const ids = rows.map(row => row.media_id), placeholders = ids.map(() => "?").join(",");
  database.query(`DELETE FROM family_media_uploads WHERE media_id IN (${placeholders})`).run(...ids);
  database.query(`DELETE FROM media WHERE id IN (${placeholders}) AND NOT EXISTS(SELECT 1 FROM message_media mm WHERE mm.media_id=media.id)`).run(...ids);
  return ids.length;
}

/** Bind a newly-created blob to the live account/login before returning its ID. */
export function claimFamilyMediaUpload(database: Database, actor: AuthenticatedPrincipal, mediaId: number, createdAt = new Date().toISOString()): void {
  requireAccountActor(database, actor);
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || !actor.authentication.sessionId || !Number.isFinite(Date.parse(createdAt))) throw new ChatAccessDenied();
  pruneExpiredFamilyMediaUploads(database);
  const count = Number((database.query("SELECT count(*) n FROM family_media_uploads WHERE owner_user_id=?").get(actor.userId) as { n: number }).n);
  if (count >= MAX_PENDING_UPLOADS_PER_OWNER) throw new Error("Too many pending family uploads. Send or wait for old uploads to expire.");
  database.query("INSERT INTO family_media_uploads(media_id,owner_user_id,login_session_id,created_at) VALUES (?,?,?,?)")
    .run(mediaId, actor.userId, actor.authentication.sessionId, createdAt);
}

/** Validate exact pending ownership and consume claims in the surrounding message transaction. */
export function consumeFamilyMediaUploads(database: Database, actor: AuthenticatedPrincipal, mediaIds: readonly number[]): void {
  const unique = [...new Set(mediaIds)];
  if (unique.length !== mediaIds.length || unique.length > 16 || unique.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new ChatAccessDenied();
  if (!unique.length) return;
  requireAccountActor(database, actor);
  const placeholders = unique.map(() => "?").join(",");
  const rows = database.query(`SELECT media_id,owner_user_id,login_session_id FROM family_media_uploads
    WHERE media_id IN (${placeholders}) ORDER BY media_id`).all(...unique) as { media_id:number;owner_user_id:string;login_session_id:string }[];
  if (rows.length !== unique.length || rows.some(row => row.owner_user_id !== actor.userId || row.login_session_id !== actor.authentication.sessionId)
    || database.query(`SELECT 1 FROM message_media WHERE media_id IN (${placeholders}) LIMIT 1`).get(...unique)) throw new ChatAccessDenied();
  database.query(`DELETE FROM family_media_uploads WHERE media_id IN (${placeholders})`).run(...unique);
}

export function readFamilyMessageMediaIds(database: Database, messageRowId: number): number[] {
  return (database.query("SELECT media_id FROM message_media WHERE message_rowid=? ORDER BY media_id").all(messageRowId) as {media_id:number}[]).map(row => row.media_id);
}
