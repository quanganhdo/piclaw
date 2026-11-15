/** Host-only controls. Session controls execute through captured native ports. */
import type { AgentControlCommand, AgentControlResult } from './agent-control-types.js';
import { handleAgentAvatar, handleAgentName } from './handlers/agent.js';
import { handleUserAvatar, handleUserGithub, handleUserName } from './handlers/user.js';
import { handleSearchWorkspace } from './handlers/info.js';
import { handleShell } from './handlers/operations.js';
import { handlePasskey } from './handlers/passkey.js';
import { handleTotp } from './handlers/totp.js';
import { handleQr } from './handlers/qr.js';

export const SESSION_INDEPENDENT_CONTROL_COMMAND_TYPES: ReadonlySet<AgentControlCommand["type"]> = new Set([
  "shell", "qr", "search_workspace", "agent_name", "agent_avatar", "user_name", "user_avatar", "user_github", "passkey", "totp",
]);

/** Host-only controls need no legacy or emulated AgentSession. */
export async function applySessionIndependentControlCommand(command: AgentControlCommand): Promise<AgentControlResult | null> {
  switch (command.type) {
    case "shell": return handleShell(undefined, command);
    case "passkey": return handlePasskey(undefined, command);
    case "totp": return handleTotp(undefined, command);
    case "qr": return handleQr(undefined, command);
    case "search_workspace": return handleSearchWorkspace(undefined, command);
    case "agent_name": return handleAgentName(undefined, command);
    case "agent_avatar": return handleAgentAvatar(undefined, command);
    case "user_name": return handleUserName(undefined, command);
    case "user_avatar": return handleUserAvatar(undefined, command);
    case "user_github": return handleUserGithub(undefined, command);
    default: return null;
  }
}
