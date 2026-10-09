/** Process-private authority for actual internally constructed requests.
 * Binding is never serialised into headers/content blocks or inferred from URL. */
import { createHash } from 'node:crypto';
import { getChatBranchByChatJid, ensureChatBranch } from '../../../db/chat-branches.js';
export type InputAuthorityPhase = 'verify' | 'before' | 'after';
export type ValidateInputAuthority = (phase?: InputAuthorityPhase) => void;
const bindings = new WeakMap<Request, { chatJid: string; pathname: string; digest: string; validate: ValidateInputAuthority }>();
const digest = (body: string) => createHash('sha256').update(body).digest('hex');

export function bindInputRequestAuthority(req: Request, chatJid: string, body: string, validate: ValidateInputAuthority): void {
  validate();
  bindings.set(req, { chatJid, pathname: new URL(req.url).pathname, digest: digest(body), validate });
}
export function readInputRequestAuthority(req: Request, chatJid: string, pathname: string): { validate: ValidateInputAuthority; verifyBody: (body: string) => void } | null {
  const binding = bindings.get(req);
  if (!binding) return null;
  if (binding.chatJid !== chatJid || binding.pathname !== pathname) throw Error('Internal input target changed.');
  return {
    validate: phase => { req.signal.throwIfAborted(); binding.validate(phase); },
    verifyBody: body => { if (digest(body) !== binding.digest) throw Error('Internal input payload changed.'); },
  };
}
export function releaseInputRequestAuthority(req: Request): void { bindings.delete(req); }

/** A trusted host may introduce a new chat, but only inside its admission TX.
 * Pre-attempt checks always use the original target; post-mutation checks use
 * this attempt's exact created lifetime. Failed attempts cannot adopt a target
 * created by someone else between retries. */
export function captureInputTarget(chatJid: string): ValidateInputAuthority {
  const key = (value: ReturnType<typeof getChatBranchByChatJid>) => JSON.stringify(value && [value.branch_id, value.chat_jid, value.archived_at]);
  const initial = getChatBranchByChatJid(chatJid);
  const originalKey = key(initial);
  let attemptKey = originalKey;
  return (phase = 'verify') => {
    const actual = getChatBranchByChatJid(chatJid);
    if (key(actual) !== (phase === 'after' ? attemptKey : originalKey) || actual?.archived_at) throw Error('Input target lifetime changed.');
    if (phase === 'before') {
      attemptKey = key(actual ?? ensureChatBranch({ chat_jid: chatJid }));
    }
  };
}
