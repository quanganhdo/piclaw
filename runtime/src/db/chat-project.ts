import { getDb } from './connection.js';
import { normalizeProjectRepository } from '../core/project-repository.js';

type ProjectRow = { branch_id: string; chat_jid: string; root_chat_jid: string; parent_branch_id: string | null; project_mode: 'set' | 'disabled' | null; project_repository: string | null; project_revision: number | null; project_updated_at: string | null };
export interface ChatProject { chat_jid: string; mode: 'inherit' | 'set' | 'disabled'; repository_url: string | null; source_chat_jid: string | null; source_branch_id: string | null; revision: string | null }
const QUERY = `SELECT b.branch_id, b.chat_jid, b.root_chat_jid, b.parent_branch_id,
  p.mode AS project_mode, p.repository_url AS project_repository, p.revision AS project_revision, p.updated_at AS project_updated_at
  FROM chat_branches b LEFT JOIN chat_projects p ON p.branch_id = b.branch_id`;

/** Missing rows inherit; disabled rows stop inheritance explicitly. */
export function getChatProject(chatJid: string): ChatProject {
  const db = getDb();
  const row = db.prepare(`${QUERY} WHERE b.chat_jid = ?`).get(chatJid) as ProjectRow | undefined;
  const result: ChatProject = { chat_jid: chatJid, mode: row?.project_mode ?? 'inherit', repository_url: null, source_chat_jid: null, source_branch_id: null, revision: null };
  const visited = new Set<string>();
  let current = row;
  while (current) {
    if (visited.has(current.branch_id) || current.root_chat_jid !== row!.root_chat_jid) return result;
    visited.add(current.branch_id);
    if (current.project_mode) {
      result.repository_url = current.project_mode === 'set' ? current.project_repository : null;
      result.source_chat_jid = current.chat_jid; result.source_branch_id = current.branch_id;
      result.revision = current.project_updated_at && current.project_revision
        ? `${current.project_updated_at}:${current.branch_id}:${current.project_revision}` : null;
      return result;
    }
    if (current.chat_jid === current.root_chat_jid || !current.parent_branch_id) break;
    current = db.prepare(`${QUERY} WHERE b.branch_id = ?`).get(current.parent_branch_id) as ProjectRow | undefined;
  }
  return result;
}

export function updateChatProject(chatJid: string, action: 'set' | 'clear' | 'inherit', repositoryUrl?: string): ChatProject {
  const db = getDb();
  const branch = db.prepare('SELECT branch_id FROM chat_branches WHERE chat_jid = ?').get(chatJid) as { branch_id: string } | undefined;
  if (!branch) throw new Error('The current chat is not registered.');
  if (action === 'inherit') db.prepare('DELETE FROM chat_projects WHERE branch_id = ?').run(branch.branch_id);
  else {
    const repository = action === 'set' ? normalizeProjectRepository(repositoryUrl) : null;
    db.prepare(`INSERT INTO chat_projects(branch_id, mode, repository_url, revision, updated_at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(branch_id) DO UPDATE SET mode=excluded.mode, repository_url=excluded.repository_url,
        revision=chat_projects.revision+1, updated_at=excluded.updated_at`)
      .run(branch.branch_id, action === 'set' ? 'set' : 'disabled', repository, new Date().toISOString());
  }
  return getChatProject(chatJid);
}
