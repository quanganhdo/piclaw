import { describe, expect, test } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { pruneOrphanToolResults } from "../../src/agent-pool/orphan-tool-results.js";

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const stamp = '2026-09-06T00:00:00.000Z';
const assistant = (content: unknown[]) => ({ role: 'assistant', content, api: 'openai-responses',
  provider: 'test', model: 'fixture', usage, stopReason: 'stop', timestamp: 1 });
const toolResult = (id: string) => ({ role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text: 'result' }], isError: false, timestamp: 2 });

function session(entries: unknown[], projected: { sourceEntry: any; messages: any[] }[], append?: (targetId: string, replacement: any) => string) {
  const manager = { getEntries: () => entries, getLeafId: () => entries.at(-1)?.id ?? null,
    buildSessionProjection: () => ({ entries: projected }), ...(append ? { appendContextEdit: append } : {}) };
  return { sessionManager: manager, agent: { state: { messages: projected.flatMap((entry) => entry.messages) } } } as unknown as AgentSession;
}
function row(id: string, message: unknown, parentId: string | null = null) {
  return { type: 'message', id, parentId, timestamp: stamp, message };
}

describe('pruneOrphanToolResults canonical projection', () => {
  test('pinned manager refuses to claim an in-memory-only repair', () => {
    const linked = row('linked', assistant([{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }]));
    const orphan = row('orphan', toolResult('call-orphan'), 'linked');
    const active = session([linked, orphan], [{ sourceEntry: linked, messages: [linked.message] }, { sourceEntry: orphan, messages: [orphan.message] }]);
    expect(() => pruneOrphanToolResults(active, 'web:test')).toThrow('Cannot persist orphan tool-result repair');
    expect((active as any).agent.state.messages).toHaveLength(2);
  });

  test('maps exact source entries, ignores linked and suffixed IDs, and rechecks projection', () => {
    const call = row('call', assistant([{ type: 'toolCall', id: 'call-1|encrypted', name: 'read', arguments: {} }]));
    const linked = row('linked', toolResult('call-1'), 'call');
    const orphan = row('orphan', toolResult('call-orphan|encrypted'), 'linked');
    const entries = [call, linked, orphan];
    const edits: { targetId: string; replacement: any }[] = [];
    const active = session(entries, entries.map((sourceEntry) => ({ sourceEntry, messages: [sourceEntry.message] })), (targetId, replacement) => {
      edits.push({ targetId, replacement });
      (active.sessionManager as any).buildSessionProjection = () => ({ entries: entries.map((sourceEntry) => ({
        sourceEntry, messages: sourceEntry.id === targetId ? [] : [sourceEntry.message],
      })) });
      return `edit-${edits.length}`;
    });
    expect(pruneOrphanToolResults(active, 'web:test')).toBe(1);
    expect(edits).toEqual([{ targetId: 'orphan', replacement: null }]);
    expect(pruneOrphanToolResults(active, 'web:test')).toBe(0);
    expect((active as any).agent.state.messages).toHaveLength(3); // old state is not authority
  });

  test('removes orphan blocks only from the mapped message content', () => {
    const call = row('call', assistant([{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }]));
    const user = row('user', { role: 'user', content: [
      { type: 'text', text: 'keep' }, { type: 'tool_result', tool_use_id: 'call-1' }, { type: 'tool_result', tool_use_id: 'orphan' },
    ], timestamp: 2 }, 'call');
    let projected = [call, user].map((sourceEntry) => ({ sourceEntry, messages: [sourceEntry.message] }));
    const edits: any[] = [];
    const active = session([call, user], projected, (targetId, replacement) => {
      edits.push({ targetId, replacement });
      projected = [{ sourceEntry: call, messages: [call.message] },
        { sourceEntry: user, messages: [{ ...user.message, content: replacement.content }] }];
      (active.sessionManager as any).buildSessionProjection = () => ({ entries: projected });
      return 'edit';
    });
    expect(pruneOrphanToolResults(active, 'web:test')).toBe(1);
    expect(edits).toEqual([{ targetId: 'user', replacement: { content: [
      { type: 'text', text: 'keep' }, { type: 'tool_result', tool_use_id: 'call-1' },
    ] } }]);
  });

  test('rejects a post-edit projection that loses retained content or breaks a linked result', () => {
    const call = row('call', assistant([{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }, { type: 'text', text: 'keep' },
      { type: 'tool_result', tool_use_id: 'orphan' }]));
    const linked = row('linked', toolResult('call-1'), 'call');
    const sources = [call, linked];
    for (const projectedContent of [[{ type: 'text', text: 'keep' }], []]) {
      let writes = 0;
      const active = session(sources, sources.map((sourceEntry) => ({ sourceEntry, messages: [sourceEntry.message] })), () => {
        writes += 1;
        (active.sessionManager as any).buildSessionProjection = () => ({ entries: [
          { sourceEntry: call, messages: [{ ...call.message, content: projectedContent }] },
          { sourceEntry: linked, messages: [linked.message] },
        ] });
        return 'edit';
      });
      expect(() => pruneOrphanToolResults(active, 'web:test')).toThrow('did not project');
      expect(writes).toBe(1);
    }
  });

  test('rejects missing or ambiguous source mappings before writing', () => {
    const orphan = toolResult('orphan');
    const source = row('source', orphan);
    let writes = 0;
    for (const projected of [
      [{ sourceEntry: { type: 'message', id: '' }, messages: [orphan] }],
      [{ sourceEntry: source, messages: [orphan, orphan] }],
    ]) {
      const active = session([source], projected, () => { writes += 1; return 'edit'; });
      expect(() => pruneOrphanToolResults(active, 'web:test')).toThrow('no exact editable session entry');
    }
    expect(writes).toBe(0);
  });

  test('mutating agent state alone does not repair the projected source', () => {
    const orphan = row('orphan', toolResult('orphan'));
    const active = session([orphan], [{ sourceEntry: orphan, messages: [orphan.message] }], (targetId) => {
      (active.sessionManager as any).buildSessionProjection = () => ({ entries: [{ sourceEntry: orphan, messages: [] }] });
      return `edit-${targetId}`;
    });
    (active as any).agent.state.messages = [];
    expect(pruneOrphanToolResults(active, 'web:test')).toBe(1);
    expect(pruneOrphanToolResults(active, 'web:test')).toBe(0);
    expect(orphan.message).toEqual(toolResult('orphan')); // raw audit entry remains
  });

  test('older manager fails closed on persisted context edits instead of resurrecting an orphan', () => {
    const source = row('source', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'orphan' }] });
    const edit = { type: 'context_edit', id: 'edit', parentId: 'source', timestamp: stamp, targetId: 'source', replacement: { content: [] } };
    let writes = 0;
    const active = { sessionManager: {
      getEntries: () => [source, edit], getLeafId: () => 'edit',
      appendContextEdit: () => { writes++; return 'duplicate'; },
    }, agent: { state: { messages: [] } } } as unknown as AgentSession;
    expect(() => pruneOrphanToolResults(active, 'web:test')).toThrow('cannot project persisted context edits');
    expect(writes).toBe(0);
  });

  test('does not treat a mutable agent array as a canonical source', () => {
    const active = { agent: { state: { messages: [toolResult('orphan')] } }, sessionManager: {
      getLeafId: () => null, getEntries: () => [],
    } } as unknown as AgentSession;
    expect(pruneOrphanToolResults(active, 'web:test')).toBe(0);
    expect((active as any).agent.state.messages).toHaveLength(1);
  });

  test('fails closed when no canonical manager is available for nonempty state', () => {
    expect(() => pruneOrphanToolResults({ agent: { state: { messages: [toolResult('orphan')] } } } as any, 'web:test'))
      .toThrow('Cannot inspect canonical session context');
  });
});
