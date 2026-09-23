/**
 * agent-control/handlers/agent.ts – Handlers for /agent-name and /agent-avatar.
 *
 * Updates the assistant's display name and avatar URL at runtime, persisting
 * the changes to the config file so they survive restarts.
 *
 * Consumers: agent-control-handlers.ts dispatches to these handlers.
 */

import { statSync } from "fs";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { getIdentityConfig, setAssistantAvatar, setAssistantName } from "../../core/config.js";
import { ensureAvatarCache } from "../../channels/web/media/avatar-service.js";
import { updateAssistantConfig } from "../agent-control-helpers.js";

type AgentNameCommand = Extract<AgentControlCommand, { type: "agent_name" }>;
type AgentAvatarCommand = Extract<AgentControlCommand, { type: "agent_avatar" }>;

/** Handle /agent-name: update the assistant display name. */
export async function handleAgentName(_session: AgentSession, command: AgentNameCommand): Promise<AgentControlResult> {
  if (!command.name) {
    return { status: "success", message: `Agent name: ${getIdentityConfig().assistantName}` };
  }

  const trimmed = command.name.trim();
  const normalized = trimmed.toLowerCase();
  const nextName = ["clear", "none", "off", "default"].includes(normalized) ? null : trimmed;
  const updated = updateAssistantConfig({ name: nextName });
  const fallback = getIdentityConfig().assistantName || process.env.ASSISTANT_NAME || "PiClaw";
  const effective = updated.name || fallback;
  setAssistantName(effective);

  return {
    status: "success",
    message: nextName ? `Agent name set to ${effective}.` : `Agent name reset to ${effective}.`,
  };
}

/** Handle /agent-avatar: update the assistant avatar URL. */
export async function handleAgentAvatar(_session: AgentSession, command: AgentAvatarCommand): Promise<AgentControlResult> {
  if (!command.avatar) {
    const current = getIdentityConfig().assistantAvatar || "(default)";
    return { status: "success", message: `Agent avatar: ${current}` };
  }

  const trimmed = command.avatar.trim();
  const normalized = trimmed.toLowerCase();
  const nextAvatar = ["clear", "none", "off", "default"].includes(normalized) ? null : trimmed;
  const effective = nextAvatar || "";

  if (!nextAvatar) {
    setAssistantAvatar("");
    return {
      status: "success",
      message: "Agent avatar reset to default.",
    };
  }

  // Keep a local cached copy for web/icon usage and report cached size.
  let cacheSuffix: string;
  try {
    const cached = await ensureAvatarCache("agent", effective || nextAvatar, { refresh: true });
    if (cached?.file) {
      const bytes = statSync(cached.file).size;
      cacheSuffix = ` Cached locally (${bytes} bytes).`;
    } else {
      return { status: "error", message: "Failed to prepare agent avatar image." };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message: `Agent avatar unchanged: ${message}` };
  }

  setAssistantAvatar(effective);
  return {
    status: "success",
    message: `Agent avatar set to ${effective || "(default)"}.${cacheSuffix}`,
  };
}
