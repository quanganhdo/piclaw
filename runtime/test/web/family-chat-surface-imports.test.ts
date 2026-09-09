import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const web = join(import.meta.dir, '../../web/src');
const source = (path: string) => readFileSync(join(web, path), 'utf8');

test('standard and family modes mount the same production chat component tree', () => {
  expect(source('ui/app-main-shell-render.ts')).toContain("import { ChatSurface } from '../components/chat-surface.js'");
  expect(source('family-chat-surface.ts')).toContain("import { ChatSurface } from './components/chat-surface.js'");

  const shared = source('components/chat-surface.ts');
  for (const component of ['Timeline', 'AgentStatus', 'ComposeBox', 'AgentRequestModal']) {
    expect(shared).toContain(`<${'${'}${component}}`);
  }
});

test('family controller no longer owns parallel chat rendering or compose controls', () => {
  const family = source('family.ts');
  for (const legacy of ['function renderPosts(', "'session-select'", "'compose-form'", "'message-text'", "'send-message'"]) {
    expect(family).not.toContain(legacy);
  }
  expect(family).toContain("import { FamilyChatSurface");
});

test('family stylesheet contains no alternate post or compose implementation', () => {
  const css = source('styles/family.css');
  for (const selector of ['.post {', '.post-meta {', '.post-text {', '#compose-form {', '#send-message {']) {
    expect(css).not.toContain(selector);
  }
  expect(css).toContain('.family-chat-surface');
});
