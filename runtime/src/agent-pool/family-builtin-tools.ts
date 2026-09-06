import {
  createReadToolDefinition, createLsToolDefinition, createFindToolDefinition, createGrepToolDefinition,
  createWriteToolDefinition, createEditToolDefinition, createBashToolDefinition, createPowerShellToolDefinition,
  type ToolDefinition, type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import { requireFamilyToolAccess } from './family-tool-access.js';
import { getChatJid } from '../core/chat-context.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { ChatAccessDenied } from '../db/session-ownership.js';

function authorise(chatJid: string, name: string): void {
  // Bind the installed definition to its session, not merely to any owned source.
  if (getChatJid('') !== chatJid || getExecutionIdentity()?.provenance.chatJid !== chatJid
    || getExecutionIdentity()?.mode !== 'family-shared') throw new ChatAccessDenied();
  requireFamilyToolAccess(name);
}

/** Preserve SDK schemas/rendering/results while guarding I/O and late private output. */
export function guardFamilyToolDefinition(tool: ToolDefinition, chatJid: string): ToolDefinition {
  return {
    ...tool,
    async execute(id, params, signal, onUpdate, ctx) {
      authorise(chatJid, tool.name);
      try {
        const result = await tool.execute(id, params, signal, onUpdate ? update => { authorise(chatJid, tool.name); onUpdate(update); } : undefined, ctx);
        authorise(chatJid, tool.name);
        return result;
      } catch (error) {
        // Do not release path-bearing errors admitted under a now-revoked login.
        authorise(chatJid, tool.name);
        throw error;
      }
    },
  };
}

/** SDK custom definitions take precedence over built-ins and extension registrations. */
export function createFamilyBuiltinTools(cwd: string, chatJid: string, customTools: ToolDefinition[] = []): ToolDefinition[] {
  const builtins: ToolDefinition[] = [
    createReadToolDefinition(cwd), createLsToolDefinition(cwd), createFindToolDefinition(cwd), createGrepToolDefinition(cwd),
    createWriteToolDefinition(cwd), createEditToolDefinition(cwd), createBashToolDefinition(cwd), createPowerShellToolDefinition(cwd),
    { ...createBashToolDefinition(cwd), name: 'local_bash', label: 'local_bash' },
  ] as ToolDefinition[];
  const names = new Set(builtins.map(tool => tool.name));
  // Never accept an injected read/shell override instead of the guarded local implementation.
  return [...customTools.filter(tool => !names.has(tool.name)), ...builtins].map(tool => guardFamilyToolDefinition(tool, chatJid));
}

/** Covers SDK-routed extension calls; arbitrary extension code is not a sandbox. */
export function createFamilyToolCallGuard(chatJid: string): ExtensionFactory {
  return pi => {
    pi.on('tool_call', event => {
      try { authorise(chatJid, event.toolName); }
      catch { return { block: true, reason: 'Session access denied.' }; }
    });
    pi.on('user_bash', () => ({ result: { output: 'Shell access denied in family mode.', exitCode: 1, cancelled: false, truncated: false } }));
  };
}
