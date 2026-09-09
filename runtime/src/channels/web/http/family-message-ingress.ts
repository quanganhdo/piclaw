import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { admitFamilyMessage, readFamilyMessageAdmission } from "../messaging/family-message-authority.js";
import { ChatAccessDenied } from "../../../db/session-ownership.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";
import { isRateLimited } from "./rate-limit.js";
import { authoriseExecutionIdentity } from "../../../agent-pool/execution-identity.js";
import { getDb } from "../../../db/connection.js";
import { getInflightMessageId, getMessageThreadRootIdById } from "../../../db.js";
import { withExecutionIdentity } from "../../../core/execution-context.js";
import {
  beginOwnedFamilySteer,
  completeOwnedFamilySteer,
  releaseOwnedFamilySteer,
  type FamilyTurnAdmissionMode,
} from "../../../db/family-turn-queue.js";

/** Narrow text-only admission; queue execution recovers authority from persisted message identity. */
export async function handleFamilyMessageIngress(channel: WebChannelLike, req: Request, actor: AuthenticatedPrincipal): Promise<Response> {
  if (req.method !== "POST" || !req.headers.get("origin") || !checkCsrfOrigin(req)) return channel.json({ error: "Session access denied." }, 403);
  if (isRateLimited(req, `data/family_message/${actor.userId}`, 60_000, 30)) return rateLimitResponse("Too many messages. Try again later.");
  try {
    const body = await req.json();
    const url = new URL(req.url);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["content", "request_id", "thread_id", "mode", "media_ids"].includes(key))
      || typeof body.content !== "string" || typeof body.request_id !== "string"
      || (body.thread_id !== undefined && body.thread_id !== null && !Number.isSafeInteger(body.thread_id))
      || (body.mode !== undefined && !["send", "queue", "queue_all", "steer", "auto"].includes(body.mode))
      || (body.media_ids !== undefined && (!Array.isArray(body.media_ids) || body.media_ids.length > 16
        || body.media_ids.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) <= 0)))) return channel.json({ error: "Invalid message request." }, 400);
    const targets = url.searchParams.getAll("chat_jid");
    if (targets.length > 1 || (targets.length === 1 && !targets[0]?.trim())) throw new ChatAccessDenied();
    const mode = (body.mode ?? "send") as FamilyTurnAdmissionMode;
    const target = targets[0]?.trim();
    const result = admitFamilyMessage(actor, { content: body.content, requestId: body.request_id, threadId: body.thread_id, chatJid: target, mode, mediaIds: body.media_ids });
    const chatJid = result.interaction.chat_jid!;
    if (result.created) {
      if (result.queue.state === "ready") channel.broadcastEvent("new_post", result.interaction);
      else channel.broadcastEvent("agent_followup_queued", {
        chat_jid: chatJid, row_id: result.interaction.id, content: body.content,
        timestamp: result.interaction.timestamp, thread_id: result.interaction.data?.thread_id ?? null,
      });
    }

    if (result.queue.state === "ready") {
      channel.resumeChat(chatJid, result.interaction.data?.thread_id ?? result.interaction.id);
      return channel.json({ user_message: result.interaction, created: result.created, queued: "message" }, result.created ? 201 : 200);
    }

    if (mode === "steer" && result.created && channel.agentPool.isStreaming?.(chatJid)) {
      let dispatching = false;
      try {
        beginOwnedFamilySteer(actor, chatJid, result.interaction.id); dispatching = true;
        const admission = readFamilyMessageAdmission(chatJid, (getDb().query("SELECT id FROM messages WHERE rowid=?").get(result.interaction.id) as { id: string }).id);
        const identity = authoriseExecutionIdentity(getDb(), "family-shared", chatJid, {
          actorUserId: admission.actor_user_id, ownerUserId: admission.owner_user_id, chatJid, kind: "interactive",
          authenticationSessionId: admission.login_session_id,
        });
        if (!identity) throw new ChatAccessDenied();
        const accepted = await withExecutionIdentity(identity, () => channel.agentPool.queueOwnedStreamingMessage?.(chatJid, body.content, "steer"));
        if (accepted?.queued) {
          const inflight = getInflightMessageId(chatJid);
          const threadId = inflight ? getMessageThreadRootIdById(chatJid, inflight) : null;
          completeOwnedFamilySteer(chatJid, result.interaction.id, threadId); dispatching = false;
          result.interaction.data.thread_id = threadId ?? result.interaction.data.thread_id;
          channel.broadcastEvent("new_post", result.interaction);
          channel.broadcastEvent("agent_steer_queued", { chat_jid: chatJid, row_id: result.interaction.id, thread_id: threadId });
          return channel.json({ user_message: result.interaction, created: true, queued: "steer", thread_id: threadId }, 201);
        }
        const released = releaseOwnedFamilySteer(chatJid, result.interaction.id); dispatching = false;
        if (released.state === "ready") {
          channel.broadcastEvent("agent_followup_consumed", { chat_jid: chatJid, row_id: result.interaction.id });
          channel.broadcastEvent("new_post", result.interaction);
          channel.resumeChat(chatJid, result.interaction.data?.thread_id ?? result.interaction.id);
          return channel.json({ user_message: result.interaction, created: true, queued: "message" }, 201);
        }
      } finally {
        if (dispatching) releaseOwnedFamilySteer(chatJid, result.interaction.id);
      }
    }

    return channel.json({ user_message: result.interaction, created: result.created, queued: "followup", row_id: result.interaction.id }, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof ChatAccessDenied) return channel.json({ error: "Session access denied." }, 403);
    return channel.json({ error: "Text message admission failed." }, 400);
  }
}
