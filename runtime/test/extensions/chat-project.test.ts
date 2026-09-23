import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { closeDatabase, getDb, initDatabase } from '../../src/db';
import { withChatContext } from '../../src/core/chat-context';
import { chatProjectTool } from '../../src/extensions/chat-project';

let tool: any;
beforeEach(() => {
  process.env.PICLAW_DB_IN_MEMORY = '1';
  closeDatabase(); initDatabase();
  getDb().exec(`INSERT INTO chats(jid) VALUES ('web:tool');
    INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at)
    VALUES ('tool','web:tool','web:tool',NULL,'tool','now','now')`);
  chatProjectTool({ registerTool(value: any) { tool = value; }, on() {} } as unknown as ExtensionAPI);
});
afterEach(() => closeDatabase());

test('agent tool is current-chat-only and persists set/get/clear/inherit', async () => {
  expect(tool.name).toBe('chat_project');
  await expect(withChatContext('web:tool', 'web', () => tool.execute('1', { action: 'set', repository_url: 'https://github.com/example/repo' }))).resolves.toMatchObject({ details: { repository_url: 'https://github.com/example/repo', mode: 'set' } });
  await expect(withChatContext('web:tool', 'web', () => tool.execute('2', { action: 'get' }))).resolves.toMatchObject({ details: { repository_url: 'https://github.com/example/repo' } });
  await expect(withChatContext('web:tool', 'web', () => tool.execute('3', { action: 'clear' }))).resolves.toMatchObject({ details: { repository_url: null, mode: 'disabled' } });
  await expect(withChatContext('web:tool', 'web', () => tool.execute('4', { action: 'inherit' }))).resolves.toMatchObject({ details: { repository_url: null, mode: 'inherit' } });
});

test('agent tool rejects missing or irrelevant repository arguments', async () => {
  await expect(withChatContext('web:tool', 'web', () => tool.execute('1', { action: 'set' }))).rejects.toThrow('required');
  await expect(withChatContext('web:tool', 'web', () => tool.execute('2', { action: 'get', repository_url: 'https://github.com/a/b' }))).rejects.toThrow('only valid');
});
