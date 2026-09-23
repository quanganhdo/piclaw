export interface ChatProjectMetadata {
  repository_url: string | null;
  source_branch_id: string | null;
  revision: string | null;
}
type State = { metadata: ChatProjectMetadata; authority: 'payload' | 'snapshot' };
const projects = new Map<string, State>();
const subscribers = new Map<string, Set<() => void>>();
function notify(chatJid: string): void { for (const listener of subscribers.get(chatJid) ?? []) listener(); }
function normalize(value: unknown): ChatProjectMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.repository_url !== null && typeof data.repository_url !== 'string') return null;
  return {
    repository_url: data.repository_url as string | null,
    source_branch_id: typeof data.source_branch_id === 'string' ? data.source_branch_id : null,
    revision: typeof data.revision === 'string' ? data.revision : null,
  };
}
export function getChatProjectRepository(chatJid: string): string | null { return projects.get(chatJid)?.metadata.repository_url ?? null; }
/** Authorised timeline/search payloads seed unknown off-chat state. A newer payload
 * may replace an older payload, but never a current-chat snapshot. */
export function seedChatProjectRepository(chatJid: string, value: unknown): void {
  const metadata = normalize(value); if (!metadata) return;
  const previous = projects.get(chatJid);
  if (previous?.authority === 'snapshot') return;
  if (previous?.metadata.revision && (!metadata.revision || metadata.revision <= previous.metadata.revision)) return;
  projects.set(chatJid, { metadata, authority: 'payload' }); notify(chatJid);
}
export function setChatProjectRepository(chatJid: string, value: unknown): void {
  const metadata = normalize(value) ?? { repository_url: null, source_branch_id: null, revision: null };
  const previous = projects.get(chatJid);
  if (previous?.authority === 'snapshot' && JSON.stringify(previous.metadata) === JSON.stringify(metadata)) return;
  projects.set(chatJid, { metadata, authority: 'snapshot' }); notify(chatJid);
}
export function subscribeChatProject(chatJid: string, listener: () => void): () => void {
  const listeners = subscribers.get(chatJid) ?? new Set();
  listeners.add(listener); subscribers.set(chatJid, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(chatJid); };
}
export function resetChatProjectStateForTests(): void { projects.clear(); subscribers.clear(); }
