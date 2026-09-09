import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAgentContextSnapshot, buildAgentStatusSnapshot } from '../../src/channels/web/agent/agent-status.js';
import { projectFamilyAgentStatusData } from '../../src/channels/web/http/family-agent-status.js';

const web = join(import.meta.dir, '../../web/src');
const source = (path: string) => readFileSync(join(web, path), 'utf8');

function context(status: Record<string, unknown> | null = null) {
  return {
    defaultChatJid: 'web:owned', json: (payload: unknown, code = 200) => Response.json(payload, { status: code }),
    getAgentStatus: () => status, getExtensionWorkingState: () => ({ message: 'extension-only' }),
    recoverStaleInflightRun: () => false,
    getBuffer: (_turnId: string, panel: 'thought' | 'draft') => ({ text: `${panel} body`, totalLines: 1, updatedAt: 1 }),
    getContextUsageForChat: async () => ({ tokens: 10, contextWindow: 100, percent: 10, sessionGeneration: 'generation' }),
    getTokenUsageForChat: () => null, getAvailableModels: async () => ({}), getProviderReadyCompletedForInstance: () => false,
  };
}

test('single-user and family status snapshots share core status semantics while family omits diagnostics', async () => {
  const fixtures = [
    { type: 'thinking', title: 'Thinking...', turn_id: 'turn' },
    { type: 'tool_call', title: 'read: /workspace/file', tool_name: 'read', tool_args: { path: '/workspace/file' }, turn_id: 'turn' },
    { type: 'intent', intent_key: 'compaction', title: 'Compacting context', started_at: '2026-09-08T10:00:00.000Z', turn_id: 'turn' },
    { type: 'intent', intent_key: 'summarization_retry', title: 'Retrying summary', retry_at: '2026-09-08T10:01:00.000Z', turn_id: 'turn' },
    { type: 'error', title: 'Agent error', detail: 'Failed safely', classifier: 'network', turn_id: 'turn' },
  ];
  for (const fixture of fixtures) {
    const standard = buildAgentStatusSnapshot('web:owned', context(fixture));
    const family = buildAgentStatusSnapshot('web:owned', context(fixture), { includeDiagnostics: false, includeExtensionWorking: false, recoverStaleInflight: false });
    expect(family.data).toEqual(standard.data);
    expect(family.status).toBe(standard.status);
    expect(family.state).toBe(standard.state);
    expect(family.chat_jid).toBe('web:owned');
    expect(family.extension_working).toBeNull();
    expect(family).not.toHaveProperty('addon_api');
    expect(family).not.toHaveProperty('mcp_startup');
  }
  expect(await buildAgentContextSnapshot('web:owned', context())).toMatchObject({ tokens: 10, contextWindow: 100, percent: 10, sessionGeneration: 'generation' });
  expect(projectFamilyAgentStatusData({ type: 'tool_call', runtime_generation: 'internal', status_hints: [{ label: 'extension' }], title: 'read' }))
    .toEqual({ type: 'tool_call', title: 'read' });
});

test('family adapter injects standard status state without privileged request, extension, workspace, or active-turn actions', () => {
  const family = source('family-chat-surface.ts');
  const shared = source('components/chat-surface.ts');
  const compose = source('components/compose-box.ts');
  for (const prop of ['agentStatus=${agentStatus}', 'agentDraft=${value.agentState?.draft ?? null}', 'agentThought=${value.agentState?.thought ?? null}', 'currentTurnId=${currentTurnId}']) {
    expect(family).toContain(prop);
  }
  expect(shared).toContain('loadWorkspaceBranch=${loadStatusWorkspaceBranch}');
  expect(family).toContain('loadStatusWorkspaceBranch=${denyStatusWorkspaceLookup}');
  expect(family).toContain('isAgentActive: activeAgentState !== null');
  expect(family).toContain("import { FamilyApi } from './family-api.js'");
  expect(family).not.toContain('pendingRequest=${');
  expect(family).not.toContain('extensionPanels=${');
  expect(family).not.toContain('onPendingRequestRespond=${');
  expect(compose).toContain('onCompact=${allowModelCompaction ? handleContextCompact : undefined}');
  expect(compose).toContain('disabled=${!canCompact}');
});
