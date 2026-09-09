/**
 * channels/web/agent-peer-message-relay-service.ts – WebChannel peer-message relay wrapper seam.
 *
 * Owns the `/agent/peer-message` request wrapper that validates payloads,
 * resolves target chats, shapes forwarded content, and relays through the
 * normal agent message path so queue/defer semantics stay unchanged.
 */

import type { AgentPool } from "../../../agent-pool.js";
import { getChatBranchByChatJid } from "../../../db.js";
import { readAccessConfig } from "../../../core/config-access.js";
import { getExecutionIdentity } from "../../../core/execution-context.js";
import { handleAgentMessage as handleAgentMessageRequest } from "../handlers/agent.js";
import { parseJsonObjectRequest } from "../json-body.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";

type PeerRelayMode = "auto" | "queue" | "steer";

type PeerRelayTargetChat = {
  chat_jid: string;
  agent_name: string;
};

function fallbackPeerAgentHandle(chatJid: string): string {
  return (chatJid.split(/[:/]/).filter(Boolean).pop() || chatJid).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "agent";
}

function buildPeerRelayContent(sourceChatJid: string, sourceAgentName: string, content: string): string {
  return `from: @${sourceAgentName} <jid:${sourceChatJid}>\n\n${content}`;
}

function buildPeerRelayBlock(input: {
  source_chat_jid: string;
  source_agent_name: string;
  target_chat_jid: string;
  target_agent_name: string;
  body: string;
}): Record<string, unknown> {
  return {
    type: "peer_message",
    source_chat_jid: input.source_chat_jid,
    source_agent_name: input.source_agent_name,
    target_chat_jid: input.target_chat_jid,
    target_agent_name: input.target_agent_name,
    body: input.body,
  };
}

type PeerRelayAgentPool = Pick<AgentPool, "listActiveChats" | "findActiveChatByAgentName" | "getAgentHandleForChat"> & {
  findChatByAgentName?: (name: string) => PeerRelayTargetChat | null;
};

export interface WebAgentPeerMessageRelayServiceOptions {
  defaultAgentId: string;
  json(payload: unknown, status?: number): Response;
  agentPool: PeerRelayAgentPool;
  getChatBranchByChatJid(chatJid: string): PeerRelayTargetChat | null;
  forwardAgentMessageRequest(req: Request, pathname: string, chatJid: string, agentId: string): Promise<Response>;
}

export interface WebAgentPeerMessageRelayChannelLike {
  json(payload: unknown, status?: number): Response;
  agentPool: PeerRelayAgentPool;
}

export function createWebAgentPeerMessageRelayService(
  channel: WebAgentPeerMessageRelayChannelLike,
  defaults: { defaultAgentId: string },
): WebAgentPeerMessageRelayService {
  return new WebAgentPeerMessageRelayService({
    defaultAgentId: defaults.defaultAgentId,
    json: (payload, status = 200) => channel.json(payload, status),
    agentPool: channel.agentPool,
    getChatBranchByChatJid,
    forwardAgentMessageRequest: (req, pathname, chatJid, agentId) =>
      handleAgentMessageRequest(channel as unknown as WebChannelLike, req, pathname, chatJid, agentId),
  });
}

export class WebAgentPeerMessageRelayService {
  constructor(private readonly options: WebAgentPeerMessageRelayServiceOptions) {}

  async handleAgentPeerMessage(req: Request): Promise<Response> {
    const accessMode = readAccessConfig().mode;
    const identity = getExecutionIdentity();
    if (accessMode !== "single-user" || (identity && identity.mode !== "single-user")) return this.options.json({ error: "Peer-message relay is unavailable in multi-user mode." }, 403);
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as {
      source_chat_jid?: string;
      source_agent_name?: string;
      target_chat_jid?: string;
      target_agent_name?: string;
      content?: string;
      mode?: PeerRelayMode;
    };

    const sourceChatJid = typeof payload.source_chat_jid === "string" ? payload.source_chat_jid.trim() : "";
    const sourceAgentName = typeof payload.source_agent_name === "string" ? payload.source_agent_name.trim() : "";
    const requestedTargetChatJid = typeof payload.target_chat_jid === "string" ? payload.target_chat_jid.trim() : "";
    const requestedTargetAgentName = typeof payload.target_agent_name === "string"
      ? payload.target_agent_name.trim().replace(/^@+/, "").trim()
      : "";
    const content = typeof payload.content === "string" ? payload.content.trim() : "";
    const mode = payload.mode === "queue" || payload.mode === "steer" || payload.mode === "auto"
      ? payload.mode
      : "auto";

    if (!sourceChatJid) return this.options.json({ error: "Missing source_chat_jid" }, 400);
    if (!requestedTargetChatJid && !requestedTargetAgentName) {
      return this.options.json({ error: "Missing target_chat_jid or target_agent_name" }, 400);
    }
    if (!content) return this.options.json({ error: "Missing content" }, 400);

    const targetChat = this.resolveTargetChat(requestedTargetChatJid, requestedTargetAgentName);
    if (!targetChat) {
      return this.options.json({
        error: requestedTargetAgentName
          ? `Unknown target agent: ${requestedTargetAgentName}`
          : `Target chat is not active: ${requestedTargetChatJid}`,
      }, 404);
    }
    if (sourceChatJid === targetChat.chat_jid) {
      return this.options.json({ error: "source_chat_jid and target chat must differ" }, 400);
    }

    const resolvedSourceAgentName = this.options.agentPool.getAgentHandleForChat(sourceChatJid);
    const effectiveSourceAgentName = sourceAgentName.trim()
      || (typeof resolvedSourceAgentName === "string" ? resolvedSourceAgentName.trim() : "")
      || fallbackPeerAgentHandle(sourceChatJid);
    const forwardedContent = buildPeerRelayContent(sourceChatJid, effectiveSourceAgentName, content);
    const forwardedBlock = buildPeerRelayBlock({
      source_chat_jid: sourceChatJid,
      source_agent_name: effectiveSourceAgentName,
      target_chat_jid: targetChat.chat_jid,
      target_agent_name: targetChat.agent_name,
      body: content,
    });
    const pathname = `/agent/${this.options.defaultAgentId}/message`;
    const forwardReq = new Request(
      `http://internal${pathname}?chat_jid=${encodeURIComponent(targetChat.chat_jid)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Piclaw-Persist-Steer": "1",
        },
        body: JSON.stringify({
          content: forwardedContent,
          content_blocks: [forwardedBlock],
          mode,
          persist_steer: true,
        }),
      },
    );

    const forwardRes = await this.options.forwardAgentMessageRequest(
      forwardReq,
      pathname,
      targetChat.chat_jid,
      this.options.defaultAgentId,
    );
    if (!forwardRes.ok) {
      return forwardRes;
    }

    const responseBody = await forwardRes.json().catch(() => ({} as Record<string, unknown>));
    return this.options.json({
      status: "ok",
      ...responseBody,
      source_chat_jid: sourceChatJid,
      source_agent_name: effectiveSourceAgentName,
      target_chat_jid: targetChat.chat_jid,
      target_agent_name: targetChat.agent_name,
      relayed: true,
    }, forwardRes.status);
  }

  private resolveTargetChat(requestedTargetChatJid: string, requestedTargetAgentName: string): PeerRelayTargetChat | null {
    if (requestedTargetChatJid) {
      return this.options.agentPool.listActiveChats().find((chat) => chat.chat_jid === requestedTargetChatJid)
        ?? this.options.getChatBranchByChatJid(requestedTargetChatJid);
    }
    return typeof this.options.agentPool.findChatByAgentName === "function"
      ? this.options.agentPool.findChatByAgentName(requestedTargetAgentName)
      : this.options.agentPool.findActiveChatByAgentName(requestedTargetAgentName);
  }
}
