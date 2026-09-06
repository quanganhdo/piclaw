import type Database from 'bun:sqlite';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { ACCOUNT_AVATAR_INPUT_BYTES, ACCOUNT_AVATAR_STORED_BYTES, ACCOUNT_AVATAR_TYPES, type OwnAccountAvatar } from '../core/account-avatar.js';
import { requireAccountActor } from './account-administration.js';
import { ChatAccessDenied } from './session-ownership.js';

export function initializeAccountAvatars(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS user_avatars (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    image BLOB CHECK (image IS NULL OR length(image) BETWEEN 1 AND 262144),
    updated_at TEXT NOT NULL
  ) STRICT;`);
}

export function readOwnAccountAvatar(database: Database, actor: AuthenticatedPrincipal): OwnAccountAvatar {
  return database.transaction(() => {
    requireAccountActor(database, actor);
    const row = database.query('SELECT revision,image IS NOT NULL AS present FROM user_avatars WHERE user_id=?').get(actor.userId) as { revision: number; present: number } | null;
    if (row && (!Number.isSafeInteger(row.revision) || row.revision < 1)) throw new ChatAccessDenied();
    return { user_id: actor.userId, revision: row?.revision ?? 0, present: Boolean(row?.present), can_edit: true };
  })();
}

export function readOwnAccountAvatarImage(database: Database, actor: AuthenticatedPrincipal): Uint8Array | null {
  return database.transaction(() => {
    requireAccountActor(database, actor);
    const row = database.query('SELECT image FROM user_avatars WHERE user_id=?').get(actor.userId) as { image: Uint8Array | null } | null;
    return row?.image ?? null;
  })();
}

function checkRevision(database: Database, actor: AuthenticatedPrincipal, revision: number): OwnAccountAvatar {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new ChatAccessDenied();
  const current = readOwnAccountAvatar(database, actor);
  if (current.revision !== revision) throw new Error('Avatar changed. Refresh before saving.');
  return current;
}

function store(database: Database, actor: AuthenticatedPrincipal, revision: number, image: Uint8Array | null): OwnAccountAvatar {
  return database.transaction(() => {
    const current = checkRevision(database, actor, revision); // Recheck live login after every async decode/read.
    if (!image && !current.present) return current;
    database.query(`INSERT INTO user_avatars(user_id,revision,image,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,image=excluded.image,updated_at=excluded.updated_at`)
      .run(actor.userId, revision+1, image, new Date().toISOString());
    return readOwnAccountAvatar(database, actor);
  }).immediate();
}

/** Strict raster-only decode; never retain originals, metadata, paths or remote URLs. */
export async function updateOwnAccountAvatar(database: Database, actor: AuthenticatedPrincipal, revision: number, input: Uint8Array, contentType: string): Promise<OwnAccountAvatar> {
  checkRevision(database, actor, revision);
  if (!input.byteLength || input.byteLength > ACCOUNT_AVATAR_INPUT_BYTES || !(ACCOUNT_AVATAR_TYPES as readonly string[]).includes(contentType)) throw new Error('Invalid avatar upload.');
  // libvips may expose only the first frame of APNG. Reject its animation chunk explicitly.
  if (contentType === 'image/png') {
    const buffer = Buffer.from(input);
    for (let offset = 8; offset+12 <= buffer.length;) {
      const length = buffer.readUInt32BE(offset);
      if (buffer.toString('ascii', offset+4, offset+8) === 'acTL') throw new Error('Animated PNG is not supported.');
      offset += length+12;
    }
  }
  const sharp = (await import('sharp')).default;
  const image = sharp(input, { limitInputPixels: 4_000_000, failOn: 'warning', animated: true }).timeout({ seconds: 5 });
  const meta = await image.metadata();
  const types: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
  if (!meta.format || types[meta.format] !== contentType || !meta.width || !meta.height || meta.width * meta.height > 4_000_000 || (meta.pages ?? 1) !== 1) throw new Error('Use a static PNG, JPEG or WebP image.');
  const bytes = await image.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  if (!bytes.length || bytes.length > ACCOUNT_AVATAR_STORED_BYTES) throw new Error('Avatar is too large.');
  return store(database, actor, revision, bytes);
}

/** Keep the revision tombstone so a stale upload cannot resurrect a removed image. */
export function removeOwnAccountAvatar(database: Database, actor: AuthenticatedPrincipal, revision: number): OwnAccountAvatar {
  return store(database, actor, revision, null);
}
