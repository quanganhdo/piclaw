import { useEffect, useState } from '../vendor/preact-htm.js';
import { getChatProjectRepository, seedChatProjectRepository, subscribeChatProject, type ChatProjectMetadata } from './chat-project-state.js';
import { currentUiChatJid } from './agent-ui-snapshot.js';

export function useChatProjectRepository(chatJid = currentUiChatJid(), payload?: ChatProjectMetadata): string | null {
  const [, update] = useState(0);
  useEffect(() => {
    seedChatProjectRepository(chatJid, payload);
    const unsubscribe = subscribeChatProject(chatJid, () => update(value => value + 1));
    update(value => value + 1);
    return unsubscribe;
  }, [chatJid, payload?.repository_url, payload?.source_branch_id, payload?.revision]);
  return getChatProjectRepository(chatJid) ?? payload?.repository_url ?? null;
}
