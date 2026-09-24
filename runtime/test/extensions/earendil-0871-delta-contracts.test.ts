import { expect, test } from 'bun:test';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { normalizeContext } from '@earendil-works/pi-ai';

const model = (provider: string, id: string) => getBuiltinModels(provider).find((entry) => entry.id === id);

test('0.87.1 frontier IDs are available only through listed catalogue providers', () => {
  for (const [provider, ids] of [
    ['anthropic', ['claude-opus-5-5']],
    ['github-copilot', ['claude-opus-5.5', 'gpt-6-sol', 'gpt-6-luna', 'grok-4.7']],
    ['openai', ['gpt-6-sol', 'gpt-6-luna']],
    ['openai-codex', ['gpt-6-sol', 'gpt-6-luna']],
    ['xai', ['grok-4.7']],
  ] as const) {
    for (const id of ids) expect(model(provider, id), `${provider}/${id}`).toBeDefined();
  }
  expect(model('anthropic', 'claude-opus-5.5')).toBeUndefined();
  expect(model('xai', 'gpt-6-sol')).toBeUndefined();
});

test('inherited OpenAI-compatible image-only user content omits an empty text part', async () => {
  const original = model('moonshotai', 'kimi-k3')!;
  let payload: any;
  const stream = streamSimple(original, normalizeContext({ messages: [{ role: 'user', content: [
    { type: 'text', text: '' }, { type: 'image', data: 'YQ==', mimeType: 'image/png' },
  ], timestamp: 1 }] }), { apiKey: 'offline-fixture', maxRetries: 0,
    onPayload: (request) => { payload = structuredClone(request); throw new Error('captured before network'); },
  });
  for await (const _event of stream) { /* consume deliberate terminal fixture error */ }
  const user = payload.messages.find((message: any) => message.role === 'user');
  expect(user).toBeDefined();
  expect(user.content).toHaveLength(1);
  expect(user.content[0].type).toBe('image_url');
});

test('Kimi K3 uses transcript-declared tool additions, not deleted deferredToolsMode', () => {
  for (const provider of ['moonshotai', 'moonshotai-cn']) {
    const kimi = model(provider, 'kimi-k3')!;
    expect(kimi.compat).toMatchObject({ supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true });
    expect((kimi.compat as any).deferredToolsMode).toBeUndefined();
  }
});
