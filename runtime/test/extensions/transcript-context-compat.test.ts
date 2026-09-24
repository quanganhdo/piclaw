import { expect, test } from 'bun:test';
import { Type } from 'typebox';
import type { Context, Tool } from '@earendil-works/pi-ai';
import { currentContextTools, providerTranscriptContext } from '../../src/extensions/transcript-context-compat.js';

const tool = (name: string): Tool => ({ name, description: name, parameters: Type.Object({}) });

test('tool lookup resolves initial, added and removed declarations without trusting stale top-level tools', () => {
  const initial = tool('initial');
  const added = tool('added');
  const context = { tools: [initial], messages: [
    { role: 'system', content: 'additional policy', toolsAdded: [added], timestamp: 1 },
    { role: 'system', content: '', toolsRemoved: [{ name: 'initial' }], timestamp: 2 },
  ] } as unknown as Context;
  expect(currentContextTools(context).map((entry) => entry.name)).toEqual(['added']);
  // The public normalizer folds the legacy initial tools into a new transcript.
  const transcript = providerTranscriptContext(context);
  expect(transcript).not.toBe(context);
  expect(transcript.messages[0]?.role).toBe('system');
  expect(currentContextTools(transcript).map((entry) => entry.name)).toEqual(['added']);
});

test('tool lookup preserves initial tools when no transcript deltas exist', () => {
  expect(currentContextTools({ tools: [tool('base')], messages: [] }).map((entry) => entry.name)).toEqual(['base']);
});
