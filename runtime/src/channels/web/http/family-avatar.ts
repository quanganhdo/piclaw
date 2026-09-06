import type Database from 'bun:sqlite';
import type { AuthenticatedPrincipal } from '../../../core/access-types.js';
import { ACCOUNT_AVATAR_INPUT_BYTES, ACCOUNT_AVATAR_TYPES } from '../../../core/account-avatar.js';
import { requireAccountActor } from '../../../db/account-administration.js';
import { readOwnAccountAvatar, readOwnAccountAvatarImage, removeOwnAccountAvatar, updateOwnAccountAvatar } from '../../../db/account-avatar.js';
import { ChatAccessDenied } from '../../../db/session-ownership.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('web.family-avatar');

/** Bounded even for chunked requests and dishonest Content-Length. No temporary files. */
async function readUpload(req: Request): Promise<Uint8Array> {
  const length = req.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > ACCOUNT_AVATAR_INPUT_BYTES)) throw new Error('Avatar is too large.');
  if (!req.body) throw new Error('Missing image.');
  const reader = req.body.getReader(), buffer = new Uint8Array(ACCOUNT_AVATAR_INPUT_BYTES);
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const signal = req.signal;
  let abort!: () => void;
  const expired = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Upload cancelled.'));
    timer = setTimeout(abort, 15_000); signal.addEventListener('abort', abort, { once: true });
  });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), expired]);
      if (done) break;
      if (size + value.byteLength > ACCOUNT_AVATAR_INPUT_BYTES) throw new Error('Avatar is too large.');
      buffer.set(value, size); size += value.byteLength;
    }
    return buffer.slice(0, size);
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => log.debug('Upload stream already closed.', { operation: 'family_avatar.cancel' })); reader.releaseLock();
  }
}

/** Called after family Origin/rate checks. Explicit pins required even for image reads. */
export async function handleFamilyAvatar(database: Database, actor: AuthenticatedPrincipal, req: Request): Promise<Response> {
  const url = new URL(req.url), method = req.method;
  if (url.search || req.headers.get('x-piclaw-account-id') !== actor.userId || req.headers.get('x-piclaw-login-id') !== actor.authentication.sessionId) throw new ChatAccessDenied();
  requireAccountActor(database, actor);
  if (url.pathname === '/account/avatar/image') {
    if (method !== 'GET') throw new ChatAccessDenied();
    const bytes = readOwnAccountAvatarImage(database, actor);
    return bytes ? new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
      : Response.json({ error: 'No account avatar.' }, { status: 404 });
  }
  if (method === 'GET') return Response.json(readOwnAccountAvatar(database, actor));
  if (method === 'POST') {
    const revision = req.headers.get('x-piclaw-avatar-revision'), type = req.headers.get('content-type') ?? '';
    if (!revision || !/^(0|[1-9]\d*)$/.test(revision) || !Number.isSafeInteger(Number(revision)) || !(ACCOUNT_AVATAR_TYPES as readonly string[]).includes(type)) throw new ChatAccessDenied();
    const bytes = await readUpload(req);
    return Response.json(await updateOwnAccountAvatar(database, actor, Number(revision), bytes, type));
  }
  if (method === 'DELETE') {
    const input = await req.json();
    if (!input || typeof input !== 'object' || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'expected_revision')) throw new ChatAccessDenied();
    return Response.json(removeOwnAccountAvatar(database, actor, input.expected_revision));
  }
  throw new ChatAccessDenied();
}
