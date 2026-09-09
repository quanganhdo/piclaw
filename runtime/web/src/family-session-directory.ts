export interface FamilySessionDirectoryEntry {
  chat_jid: string;
  root_chat_jid: string;
  agent_name: string;
}

function valid(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 512;
}

/** Render only the already-authorized directory rows, grouped by their stored root. */
export function renderFamilySessionDirectory(select: HTMLSelectElement, value: unknown): void {
  if (!Array.isArray(value)) throw new Error('Invalid session directory.');
  const entries = value as FamilySessionDirectoryEntry[];
  const roots = new Map<string, FamilySessionDirectoryEntry>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!valid(entry?.chat_jid) || !valid(entry.root_chat_jid) || !valid(entry.agent_name) || seen.has(entry.chat_jid)) throw new Error('Invalid session directory.');
    seen.add(entry.chat_jid);
    if (entry.chat_jid === entry.root_chat_jid) roots.set(entry.root_chat_jid, entry);
  }
  if (entries.some(entry => !roots.has(entry.root_chat_jid))) throw new Error('Invalid session directory.');

  const fragment = document.createDocumentFragment();
  for (const [rootChatJid, root] of roots) {
    const group = document.createElement('optgroup');
    group.label = `@${root.agent_name} · ${rootChatJid}`;
    for (const entry of entries) {
      if (entry.root_chat_jid !== rootChatJid) continue;
      const option = document.createElement('option'); option.value = entry.chat_jid;
      option.textContent = entry.chat_jid === rootChatJid ? `@${entry.agent_name} · root` : `↳ @${entry.agent_name}`;
      group.append(option);
    }
    fragment.append(group);
  }
  select.replaceChildren(fragment);
}
