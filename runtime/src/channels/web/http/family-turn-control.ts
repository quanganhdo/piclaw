import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { getDb } from "../../../db/connection.js";
import { authoriseExecutionIdentity } from "../../../agent-pool/execution-identity.js";
import { withExecutionIdentity } from "../../../core/execution-context.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import {
  beginOwnedFamilySteer,
  completeOwnedFamilySteer,
  listOwnedFamilyQueuedTurns,
  releaseOwnedFamilySteer,
  removeOwnedFamilyQueuedTurn,
  reorderOwnedFamilyQueuedTurns,
} from "../../../db/family-turn-queue.js";
import { getInflightMessageId, getMessageByRowId, getMessageThreadRootIdById } from "../../../db.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";
import { isRateLimited } from "./rate-limit.js";

function target(actor: AuthenticatedPrincipal, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ChatAccessDenied();
  return resolveAuthorisedChat(getDb(), actor, value.trim(), "session.write").chatJid;
}

function identity(actor: AuthenticatedPrincipal, chatJid: string) {
  const value = authoriseExecutionIdentity(getDb(), "family-shared", chatJid, {
    actorUserId: actor.userId, ownerUserId: actor.userId, chatJid, kind: "interactive",
    authenticationSessionId: actor.authentication.sessionId ?? undefined,
  });
  if (!value) throw new ChatAccessDenied();
  return value;
}

export async function handleFamilyTurnControl(channel: WebChannelLike, req: Request, actor: AuthenticatedPrincipal): Promise<Response> {
  try {
    const path = new URL(req.url).pathname;
    if (isRateLimited(req, `data/family_turn_control/${actor.userId}`, 60_000, 120)) return rateLimitResponse("Too many turn controls. Try again later.");
    if (path === "/agent/queue-state") {
      if (req.method !== "GET") throw new ChatAccessDenied();
      const url = new URL(req.url), values = url.searchParams.getAll("chat_jid");
      if ([...url.searchParams.keys()].some(key => key !== "chat_jid") || values.length !== 1) throw new ChatAccessDenied();
      const items = listOwnedFamilyQueuedTurns(actor, values[0]);
      return channel.json({ count: items.length, items });
    }
    if (req.method !== "POST" || !req.headers.get("origin") || !checkCsrfOrigin(req)) throw new ChatAccessDenied();
    const body = await req.json();
    if (req.signal.aborted) throw new ChatAccessDenied();
    if (!body || typeof body !== "object" || Array.isArray(body)) return channel.json({ error: "Invalid turn control request." }, 400);
    const chatJid = target(actor, body.chat_jid);
    if (req.signal.aborted) throw new ChatAccessDenied();
    if (path === "/agent/queue-remove") {
      if (Object.keys(body).some(key => !["chat_jid", "row_id"].includes(key)) || !Number.isSafeInteger(body.row_id)) return channel.json({ error: "Invalid queue removal." }, 400);
      const removed = removeOwnedFamilyQueuedTurn(actor, chatJid, body.row_id);
      if (removed) channel.broadcastEvent("agent_followup_removed", { chat_jid: chatJid, row_id: body.row_id });
      return channel.json({ status: "ok", removed, count: listOwnedFamilyQueuedTurns(actor, chatJid).length });
    }
    if (path === "/agent/queue-reorder") {
      if (Object.keys(body).some(key => !["chat_jid", "from_index", "to_index"].includes(key))) return channel.json({ error: "Invalid queue reorder." }, 400);
      const reordered = reorderOwnedFamilyQueuedTurns(actor, chatJid, body.from_index, body.to_index);
      return channel.json({ status: "ok", reordered });
    }
    if (path === "/agent/queue-steer") {
      if (Object.keys(body).some(key => !["chat_jid", "row_id"].includes(key)) || !Number.isSafeInteger(body.row_id)) return channel.json({ error: "Invalid queue steering request." }, 400);
      beginOwnedFamilySteer(actor, chatJid, body.row_id);
      try {
        const admission = getDb().query("SELECT message_id FROM message_execution_authorities WHERE message_rowid=? AND chat_jid=? AND owner_user_id=?")
          .get(body.row_id, chatJid, actor.userId) as { message_id: string } | null;
        if (!admission) throw new ChatAccessDenied();
        // The immutable admission proves owner/message authority; the current
        // control request supplies the fresh live login used for this mutation.
        const execution = identity(actor, chatJid);
        const interaction = getMessageByRowId(chatJid, body.row_id);
        if (!interaction || typeof interaction.data?.content !== "string") throw new ChatAccessDenied();
        const result = await withExecutionIdentity(execution, () => channel.agentPool.queueOwnedStreamingMessage?.(chatJid, interaction.data.content, "steer"));
        if (!result?.queued) {
          releaseOwnedFamilySteer(chatJid, body.row_id);
          return channel.json({ status: "ok", removed: false, queued: false, count: listOwnedFamilyQueuedTurns(actor, chatJid).length });
        }
        const inflight = getInflightMessageId(chatJid);
        const threadId = inflight ? getMessageThreadRootIdById(chatJid, inflight) : null;
        completeOwnedFamilySteer(chatJid, body.row_id, threadId);
        interaction.data.thread_id = threadId ?? interaction.data.thread_id;
        channel.broadcastEvent("agent_followup_removed", { chat_jid: chatJid, row_id: body.row_id });
        channel.broadcastEvent("new_post", interaction);
        channel.broadcastEvent("agent_steer_queued", { chat_jid: chatJid, row_id: body.row_id, thread_id: threadId });
        return channel.json({ status: "ok", removed: true, queued: "steer", user_message: interaction, thread_id: threadId, count: listOwnedFamilyQueuedTurns(actor, chatJid).length }, 201);
      } catch (error) {
        try { releaseOwnedFamilySteer(chatJid, body.row_id); } catch { /* accepted/terminal or already restored */ }
        throw error;
      }
    }
    if (path === "/agent/runs/abort") {
      if (Object.keys(body).some(key => !["chat_jid", "turn_id"].includes(key)) || (body.turn_id !== undefined && typeof body.turn_id !== "string")) return channel.json({ error: "Invalid abort request." }, 400);
      const status = channel.getAgentStatus(chatJid);
      const activeTurn = typeof status?.turn_id === "string" ? status.turn_id : "";
      if (body.turn_id && activeTurn && body.turn_id !== activeTurn) return channel.json({ error: "turn_id does not match the active run" }, 409);
      const result = await withExecutionIdentity(identity(actor, chatJid), () => channel.agentPool.abortOwnedRun?.(chatJid));
      return channel.json({ status: "ok", chat_jid: chatJid, turn_id: activeTurn || null, result });
    }
    throw new ChatAccessDenied();
  } catch (error) {
    if (error instanceof ChatAccessDenied) return channel.json({ error: "Session access denied." }, 403);
    return channel.json({ error: "Turn control failed." }, 400);
  }
}
