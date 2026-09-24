import { expect, test } from 'bun:test';
import type { Model, Tool } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { attemptRemoteCompaction } from '../../src/extensions/smart-compaction/remote-compaction.js';

const model = { provider: 'openai', id: 'gpt-5.1', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1', input: ['text', 'image'], reasoning: false } as Model<any>;
const tool = (name: string): Tool => ({ name, description: name, parameters: Type.Object({}) });

test('remote compaction keeps tools at request level and omits system instructions from converted input', async () => {
  let body: any;
  const result = await attemptRemoteCompaction({
    model,
    auth: { ok: true, apiKey: 'test-key', headers: {} },
    messages: [{ role: 'user', content: 'hello', timestamp: 1 }],
    systemPrompt: 'PRIVATE_SYSTEM_INSTRUCTIONS',
    tools: [tool('deferred')],
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    signal: new AbortController().signal,
    timeoutMs: 1000,
    fetchFn: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output: [{ type: 'compaction', encrypted_content: 'opaque' }] }), { status: 200 });
    },
  });
  expect(result).toMatchObject({ ok: true });
  expect(body).toBeDefined();
  expect(body.tools.map((entry: any) => entry.name)).toEqual(['deferred']);
  expect(body.instructions).toBe('PRIVATE_SYSTEM_INSTRUCTIONS');
  expect(JSON.stringify(body.input)).not.toContain('PRIVATE_SYSTEM_INSTRUCTIONS');
});
