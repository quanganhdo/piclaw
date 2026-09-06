import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { admitFamilyMessage } from "../messaging/family-message-authority.js";
import { ChatAccessDenied } from "../../../db/session-ownership.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";
import { isRateLimited } from "./rate-limit.js";

/** Narrow text-only admission; queue execution recovers authority from persisted message identity. */
export async function handleFamilyMessageIngress(channel: WebChannelLike, req: Request, actor: AuthenticatedPrincipal): Promise<Response> {
  if (req.method !== "POST" || !req.headers.get("origin") || !checkCsrfOrigin(req)) return channel.json({ error: "Session access denied." }, 403);
  if (isRateLimited(req, "data/family_message", 60_000, 30)) return rateLimitResponse("Too many messages. Try again later.");
  try {
    const body = await req.json();
    const url = new URL(req.url);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["content", "request_id", "thread_id"].includes(key))
      || typeof body.content !== "string" || typeof body.request_id !== "string"
      || (body.thread_id !== undefined && body.thread_id !== null && !Number.isSafeInteger(body.thread_id))) return channel.json({ error: "Invalid text message request." }, 400);
    const targets = url.searchParams.getAll("chat_jid");
    if (targets.length > 1 || (targets.length === 1 && !targets[0]?.trim())) throw new ChatAccessDenied();
    const result = admitFamilyMessage(actor, { content: body.content, requestId: body.request_id, threadId: body.thread_id, chatJid: targets[0]?.trim() });
    if (result.created) channel.broadcastEvent("new_post", result.interaction);
    channel.resumeChat(result.interaction.chat_jid!, result.interaction.data?.thread_id ?? result.interaction.id);
    return channel.json({ user_message: result.interaction, created: result.created, queued: "message" }, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof ChatAccessDenied) return channel.json({ error: "Session access denied." }, 403);
    return channel.json({ error: "Text message admission failed." }, 400);
  }
}
