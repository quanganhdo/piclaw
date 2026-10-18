import { handleAgentMessage } from '../../../src/channels/web/handlers/agent.js';
import { AgentStatusStore } from '../../../src/channels/web/agent/agent-status-store.js';
import { handleAgentStatusRequest } from '../../../src/channels/web/agent/agent-status.js';

// Disposable production handler/store; only the SDK operation/publication are held.
export function manualCompactionBackend() {
  const events: Array<{ type: string; data: any }> = [];
  let release!: (value: any) => void;
  let publish!: () => void;
  let active = false;
  let aborts = 0;
  let messageId = 456;
  const store = new AgentStatusStore({ load() {}, save() {}, setAgentStatus() {}, getAgentStatuses: () => ({}) },
    { getInflightRuns: () => [], getPreflightRuns: () => [] });
  const channel: any = {
    agentPool: {
      isStreaming: () => false, isActive: () => active,
      applyControlCommand: async (_chat: string, command: any) => {
        if (command.type === 'abort') {
          aborts++; active = false; release({ status: 'error', message: 'Compaction cancelled.' });
          return { status: 'success', message: 'Compaction aborted.' };
        }
        if (command.type === 'stats') return { status: 'success', message: 'Stats result' };
        return new Promise(resolve => { release = resolve; });
      },
    },
    json: (body: any, status = 200) => Response.json(body, { status }),
    getQueuedFollowupCount: () => 0,
    broadcastEvent(type: string, data: any) { events.push({ type, data }); },
    getAgentStatus: (chat: string) => store.get(chat),
    updateAgentStatus(chat: string, data: any) { store.update(chat, data); },
    storeMessage: (_chat: string, content: string) => ({ id: messageId++, timestamp: new Date(Date.UTC(2026, 9, 15, 12, 0, 0, messageId)).toISOString(), data: { thread_id: null }, content }),
    sendMessage: async () => {
      events.push({ type: 'agent_response', data: { chat_jid: 'web:hook-fixture', id: 457, content: 'Command result' } });
      await new Promise<void>(resolve => { publish = resolve; });
    },
  };
  const context: any = {
    defaultChatJid: 'web:hook-fixture', json: channel.json, getAgentStatus: channel.getAgentStatus,
    getExtensionWorkingState: () => null, recoverStaleInflightRun() { throw Error('Unexpected recovery'); }, getBuffer: () => undefined,
  };
  return {
    events, get aborts() { return aborts; },
    finish(status: string) { active = false; release({ status, message: `Compaction ${status}` }); },
    publish() { publish(); },
    async fetch(request: Request): Promise<Response | null> {
      const path = new URL(request.url).pathname;
      if (path === '/manual') return handleAgentMessage(channel, request, '/agent/default/message', 'web:hook-fixture', 'default');
      if (path === '/status') return handleAgentStatusRequest(request, context);
      return null;
    },
    cleanup() { store.clearPersistedStatuses(); },
  };
}
