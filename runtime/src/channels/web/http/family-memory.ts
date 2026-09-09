import type { AuthenticatedPrincipal } from '../../../core/access-types.js';
import { readAccessConfig } from '../../../core/config-access.js';
import { getConfigPath, getWorkspaceDir, getStoreDir, getDataDir } from '../../../core/config-context.js';
import { getExecutionIdentity } from '../../../core/execution-context.js';
import { getDb } from '../../../db/connection.js';
import { requireAccountActor } from '../../../db/account-administration.js';
import { ChatAccessDenied } from '../../../db/session-ownership.js';
import { listOwnFamilyMemoryPublications, listSharedFamilyMemory, previewOwnFamilyMemorySource,
  publishOwnFamilyMemory, readOwnFamilyMemoryPublication, withdrawOwnFamilyMemory } from '../../../db/family-memory.js';
import type { WebChannelLike } from '../core/web-channel-contracts.js';
import { checkCsrfOrigin, rateLimitResponse } from './security.js';
import { isRateLimitedForClient } from './rate-limit.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('web.family-memory');
const paths = () => JSON.stringify([getConfigPath(), getWorkspaceDir(), getStoreDir(), getDataDir()]);

async function readBody(req: Request, maxBytes: number, validate: () => void): Promise<Record<string, unknown>> {
  if (!req.body) throw new ChatAccessDenied();
  const reader = req.body.getReader(), buffer = new Uint8Array(maxBytes), started = performance.now();
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined, abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new ChatAccessDenied()); timer = setTimeout(abort, 10000);
    req.signal.addEventListener('abort', abort, { once: true });
  });
  try {
    for (;;) {
      validate();
      const { done, value } = await Promise.race([reader.read(), cancelled]);
      validate();
      if (performance.now() - started >= 10000) throw new ChatAccessDenied();
      if (done) break;
      if (size + value.byteLength > buffer.length) throw new ChatAccessDenied();
      buffer.set(value, size); size += value.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatAccessDenied();
    validate();
    return value as Record<string, unknown>;
  } catch { throw new ChatAccessDenied(); }
  finally {
    clearTimeout(timer); req.signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => log.debug('Memory request stream already closed', { operation: 'family_memory.cancel' }));
    reader.releaseLock();
  }
}

/** Explicit browser control-plane requests; no automatic projection, model, queue or filesystem effects. */
export async function handleFamilyMemory(channel: WebChannelLike, req: Request, principal: AuthenticatedPrincipal): Promise<Response> {
  const deny = () => channel.json({ error: 'Session access denied.' }, 403), url = new URL(req.url);
  const collection = url.pathname === '/agent/family-memory', preview = url.pathname === '/agent/family-memory/preview';
  const own = url.pathname === '/agent/family-memory/own', shared = url.pathname === '/agent/family-memory/shared';
  const match = url.pathname.match(/^\/agent\/family-memory\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(\/withdraw)?$/);
  if (url.search || (!collection && !preview && !own && !shared && !match)) return deny();
  const reading = req.method === 'GET' && (own || shared || (match && !match[2]));
  const posting = req.method === 'POST' && (collection || preview || match?.[2] === '/withdraw');
  if (!reading && !posting) return deny();
  if (posting && (!req.headers.get('origin') || !checkCsrfOrigin(req)
    || req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')) return deny();
  try {
    const actor = Object.freeze({ ...principal, authentication: Object.freeze({ ...principal.authentication }) });
    const database = getDb(), pinnedPaths = paths(); let denied = false;
    const validate = () => {
      try {
        if (denied || req.signal.aborted || getExecutionIdentity() || readAccessConfig().mode !== 'family-shared'
          || getDb() !== database || paths() !== pinnedPaths || req.headers.get('x-piclaw-account-id') !== actor.userId
          || req.headers.get('x-piclaw-login-id') !== actor.authentication.sessionId) throw new ChatAccessDenied();
        requireAccountActor(database, actor, { recent: Boolean(posting) });
      } catch { denied = true; throw new ChatAccessDenied(); }
    };
    validate();
    if (reading) {
      if (isRateLimitedForClient(actor.userId, 'family_memory_read', 60000, 60)) return rateLimitResponse('Too many memory reads.');
      const result = own ? listOwnFamilyMemoryPublications(database, actor) : shared ? listSharedFamilyMemory(database, actor)
        : readOwnFamilyMemoryPublication(database, actor, match![1]!);
      validate(); return channel.json(result);
    }
    const bucket = preview ? 'family_memory_preview' : collection ? 'family_memory_publish' : 'family_memory_withdraw';
    if (isRateLimitedForClient(actor.userId, bucket, 60000, 20)) return rateLimitResponse('Too many memory requests.');
    const value = await readBody(req, collection ? 128 * 1024 : preview ? 4096 : 1024, validate);
    validate();
    if (preview) return channel.json(previewOwnFamilyMemorySource(database, actor, value as Parameters<typeof previewOwnFamilyMemorySource>[2]));
    if (collection) {
      const result = publishOwnFamilyMemory(database, actor, value as Parameters<typeof publishOwnFamilyMemory>[2]);
      return channel.json({ ...result, request_id: value.request_id }, result.created ? 201 : 200);
    }
    const result = withdrawOwnFamilyMemory(database, actor, match![1]!, value as { confirm: true });
    return channel.json(result, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof ChatAccessDenied || req.signal.aborted) return deny();
    // Storage errors can include user data; neither logs nor HTTP expose the exception payload.
    log.error('Memory request failed', { operation: 'family_memory.request_failed' });
    return channel.json({ error: 'Memory request failed.' }, 500);
  }
}
