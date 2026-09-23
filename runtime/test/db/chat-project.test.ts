import { afterEach, beforeEach, expect, test } from 'bun:test';
import { closeDatabase, getDb, initDatabase } from '../../src/db';
import { getChatProject, updateChatProject } from '../../src/db/chat-project';

beforeEach(() => {
  process.env.PICLAW_DB_IN_MEMORY = '1';
  closeDatabase(); initDatabase();
  getDb().exec(`
    INSERT INTO chats(jid) VALUES ('web:root'), ('web:child'), ('web:grandchild');
    INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at) VALUES
      ('root','web:root','web:root',NULL,'root','now','now'),
      ('child','web:child','web:root','root','child','now','now'),
      ('grandchild','web:grandchild','web:root','child','grandchild','now','now');
  `);
});
afterEach(() => closeDatabase());

test('chat repositories inherit through actual parents and support override, disable and inherit', () => {
  expect(getChatProject('web:grandchild')).toMatchObject({ mode: 'inherit', repository_url: null });
  expect(updateChatProject('web:root', 'set', 'https://github.com/example/core.git/')).toMatchObject({ mode: 'set', repository_url: 'https://github.com/example/core', source_chat_jid: 'web:root' });
  expect(getChatProject('web:grandchild').repository_url).toBe('https://github.com/example/core');
  expect(updateChatProject('web:child', 'set', 'https://gitea.example/prefix/team/addons').repository_url).toBe('https://gitea.example/prefix/team/addons');
  expect(getChatProject('web:grandchild').source_chat_jid).toBe('web:child');
  expect(updateChatProject('web:grandchild', 'clear')).toMatchObject({ mode: 'disabled', repository_url: null, source_chat_jid: 'web:grandchild' });
  expect(updateChatProject('web:grandchild', 'inherit').repository_url).toBe('https://gitea.example/prefix/team/addons');
});

test('repository validation rejects non-web, credentialled and navigational URLs', () => {
  for (const value of ['git@example.com:a/b', 'javascript:alert(1)', 'https://u:p@example.com/a/b', 'https://example.com/a/../b', 'https://example.com/only-one']) {
    expect(() => updateChatProject('web:root', 'set', value)).toThrow();
  }
});

test('chat project state is removed with its branch', () => {
  updateChatProject('web:child', 'set', 'https://github.com/example/child');
  getDb().prepare('DELETE FROM chat_branches WHERE chat_jid = ?').run('web:child');
  expect((getDb().prepare('SELECT COUNT(*) AS count FROM chat_projects').get() as { count: number }).count).toBe(0);
});
