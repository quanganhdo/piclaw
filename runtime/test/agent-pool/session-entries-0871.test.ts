import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import { buildSessionContext, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { adoptedJsonl } from './adopted-session-fixture.js';
import { inspectAdoptedSession } from '../../src/agent-pool/adopted-session.js';
import { computePromptCacheWaste } from '../../src/agent-pool/cache-stats.js';
import { createSessionManagerPersistencePort } from '../../src/agent-pool/session-persistence.js';
import { seedSessionManagerFromDeferredBranchSeed, type DeferredBranchSeed } from '../../src/agent-pool/branch-seeding.js';

const stamp = '2026-09-06T00:00:00.000Z';
const append = (rows: any[], entries: any[]) => {
  const copy = [...rows];
  let parentId = copy.at(-1).id;
  for (const entry of entries) {
    copy.push({ ...entry, parentId, timestamp: stamp });
    parentId = entry.id;
  }
  return JSON.stringify(copy[0]) + '\n' + copy.slice(1).map((entry) => JSON.stringify(entry)).join('\n') + '\n';
};
const inspect = (jsonl: string) => inspectAdoptedSession(jsonl, createHash('sha256').update(jsonl).digest('hex'));

test('adoption projects omitted and replaced context while accepting separate usage and null compaction', () => {
  const { rows } = adoptedJsonl('/tmp/adoption', '/tmp/parent.jsonl');
  const jsonl = append(rows, [
    { type: 'usage', id: 'usage', kind: 'cache_warm', provider: 'test', model: 'fixture', usage: rows[4].message.usage },
    { type: 'context_edit', id: 'omit', targetId: 'user', replacement: null },
    { type: 'context_edit', id: 'replace', targetId: 'assistant', replacement: { content: [{ type: 'text', text: 'REPLACED' }] } },
  ]);
  const result = inspect(jsonl);
  expect(result.context.messages.some((message: any) => message.role === 'user')).toBe(false);
  expect(result.context.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'REPLACED' }]);
  expect(result.entryCount).toBe(10);
  const stringReplacement = append(rows, [{ type: 'context_edit', id: 'replace', targetId: 'assistant', replacement: { content: 'plain text' } }]);
  expect(inspect(stringReplacement).context.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'plain text' }]);
  const compacted = append(rows, [
    { type: 'compaction', id: 'compact', summary: 'summary', firstKeptEntryId: null, tokensBefore: 12 },
    { type: 'message', id: 'after-compact', message: rows[4].message },
  ]);
  expect(inspect(compacted).context.messages.length).toBeGreaterThan(0);
});

test('adoption rejects invalid, orphan, non-ancestral and non-editable targets and malformed replacement', () => {
  const { rows } = adoptedJsonl('/tmp/adoption', '/tmp/parent.jsonl');
  for (const entry of [
    { type: 'context_edit', id: 'bad', targetId: 'missing', replacement: null },
    { type: 'context_edit', id: 'bad', targetId: 'model', replacement: null },
    { type: 'context_edit', id: 'bad', targetId: 'user', replacement: { content: [{ type: 'text', text: 9 }] } },
    { type: 'usage', id: 'bad', kind: 'cache_warm', provider: 'test', model: 'fixture', usage: { input: -1 } },
  ]) expect(() => inspect(append(rows, [entry]))).toThrow();
  const fork = [...rows, { type: 'message', id: 'sibling', parentId: 'model', timestamp: stamp, message: rows[3].message },
    { type: 'context_edit', id: 'bad', parentId: 'name', timestamp: stamp, targetId: 'sibling', replacement: null }];
  const jsonl = fork.map((row) => JSON.stringify(row)).join('\n') + '\n';
  expect(() => inspect(jsonl)).toThrow('Context edit target is not on this branch');
});

test('deferred fork omits usage, maps surviving edits and preserves null compaction', async () => {
  const calls: string[] = [];
  let serial = 0;
  const write = async (name: string) => { calls.push(name); return `new-${++serial}`; };
  const port = {
    appendMessage: async () => write('message'),
    appendThinkingLevelChange: async () => write('thinking'),
    appendModelChange: async () => write('model'),
    appendCompaction: async (_summary: string, first: string | null) => write(`compact:${first}`),
    appendContextEdit: async (target: string, replacement: unknown) => write(`edit:${target}:${replacement === null ? 'omit' : 'replace'}`),
    appendSessionInfo: async () => write('info'),
    appendCustomMessageEntry: async () => write('custom-message'),
    appendCustomEntry: async () => write('custom'),
  };
  const seed: DeferredBranchSeed = {
    version: 1, parentSession: null, sessionName: null, model: null, thinkingLevel: null, mode: 'stable_branch',
    branchEntries: [
      { type: 'message', id: 'old-message', parentId: null, timestamp: stamp, message: { role: 'user', content: 'hello', timestamp: 1 } } as SessionEntry,
      { type: 'usage', id: 'old-usage', parentId: 'old-message', timestamp: stamp, kind: 'cache_warm', provider: 'test', model: 'fixture', usage: {} },
      { type: 'context_edit', id: 'old-edit', parentId: 'old-usage', timestamp: stamp, targetId: 'old-message', replacement: null },
      { type: 'compaction', id: 'old-compact', parentId: 'old-edit', timestamp: stamp, summary: 'summary', firstKeptEntryId: null, tokensBefore: 2 },
    ],
  };
  await seedSessionManagerFromDeferredBranchSeed(port, seed);
  expect(calls).toEqual(['message', 'edit:new-1:omit', 'compact:null']);
  seed.branchEntries![2] = { type: 'context_edit', id: 'unmapped', parentId: 'old-usage', timestamp: stamp, targetId: 'missing', replacement: null };
  calls.length = 0;
  await expect(seedSessionManagerFromDeferredBranchSeed(port, seed)).rejects.toThrow('unmappable target');
  expect(calls).toEqual([]);
});

test('nullable compaction is forwarded; pinned 0.85.1 fails closed on context-edit replay', async () => {
  const port = createSessionManagerPersistencePort({
    appendCompaction: (_summary, first) => { expect(first).toBeNull(); return 'compact'; },
  } as any);
  expect(await port.appendCompaction('summary', null, 0)).toBe('compact');
  expect(port.appendContextEdit).toBeUndefined();
});

test('0.85.1 rollback cannot safely reopen context-edited 0.87.1 JSONL', () => {
  const { rows } = adoptedJsonl('/tmp/adoption', '/tmp/parent.jsonl');
  const jsonl = append(rows, [{ type: 'context_edit', id: 'omit', targetId: 'user', replacement: null }]);
  const inspected = inspect(jsonl);
  expect(inspected.context.messages.some((message: any) => message.role === 'user')).toBe(false);
  // The pinned 0.85.1 SDK silently ignores 0.87.1 edits during its projection.
  expect(buildSessionContext(inspected.entries).messages.some((message) => message.role === 'user')).toBe(true);
});

test('usage entries do not add a prompt-cache request and edits reset the comparison', () => {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 10_000, totalTokens: 10_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = (id: string, input: number) => ({ type: 'message', id, parentId: null, timestamp: stamp,
    message: { role: 'assistant', provider: 'test', model: 'fixture', timestamp: 1, usage: { ...usage, input, cacheWrite: input ? 0 : 10_000 } } }) as SessionEntry;
  const entries = [assistant('first', 0), { type: 'usage', id: 'separate', kind: 'cache_warm', provider: 'test', model: 'fixture', usage } as unknown as SessionEntry,
    assistant('second', 10_000)];
  expect(computePromptCacheWaste(entries, {}).missCount).toBe(1);
  entries.splice(2, 0, { type: 'context_edit', targetId: 'first', replacement: null } as unknown as SessionEntry);
  expect(computePromptCacheWaste(entries, {}).missCount).toBe(0);
});
