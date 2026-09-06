import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { getDb } from "../../../db/connection.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import { recoverFamilyMessage, readFamilyRecoveryStatus, dismissLegacyInput } from "../messaging/family-message-recovery.js";
import { checkCsrfOrigin, rateLimitResponse } from "./security.js";
import { isRateLimited } from "./rate-limit.js";
import { createUuid } from "../../../utils/ids.js";

/** Serialize recovery on the processing lane, without hydrating or aborting a target. */
export async function handleFamilyMessageRecovery(channel: WebChannelLike, req: Request, actor: AuthenticatedPrincipal): Promise<Response> {
  const deny = () => channel.json({ error: "Session access denied." }, 403);
  if (req.method === "GET") {
    const values = new URL(req.url).searchParams.getAll("chat_jid");
    if (values.length > 1 || (values.length === 1 && !values[0]?.trim())) return deny();
    try { return channel.json(readFamilyRecoveryStatus(actor, values[0])); }
    catch (error) { if (error instanceof ChatAccessDenied) return deny(); throw error; }
  }
  if (req.method !== "POST" || !req.headers.get("origin") || !checkCsrfOrigin(req)) return deny();
  if (isRateLimited(req, "data/family_recovery", 60_000, 20)) return rateLimitResponse("Too many recovery requests.");
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["chat_jid", "message_rowid", "request_id", "action"].includes(key))
      || typeof body.chat_jid !== "string" || !Number.isSafeInteger(body.message_rowid) || body.message_rowid <= 0
      || typeof body.request_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.request_id) || !["retry", "skip", "dismiss-legacy"].includes(body.action)) return channel.json({ error: "Invalid recovery request." }, 400);
    requireAccountActor(getDb(), actor, { recent: true });
    const target = resolveAuthorisedChat(getDb(), actor, body.chat_jid, "session.write");
    let cancelled = req.signal.aborted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const result = await new Promise<ReturnType<typeof recoverFamilyMessage> | ReturnType<typeof dismissLegacyInput>>((resolve, reject) => {
      onAbort = () => { cancelled = true; reject(new Error("Recovery request cancelled.")); };
      if (cancelled) { onAbort(); return; }
      req.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(onAbort, 30_000);
      // Unique queue key avoids dropped-promise hangs from queue-level deduplication; DB key deduplicates effects.
      channel.queue.enqueue(async () => {
        try {
          if (cancelled) return;
          const recovered = body.action==='dismiss-legacy'
            ? dismissLegacyInput(actor,{chatJid:target.chatJid,messageRowId:body.message_rowid,requestId:body.request_id})
            : recoverFamilyMessage(actor, { chatJid: target.chatJid, messageRowId: body.message_rowid, requestId: body.request_id, action: body.action });
          channel.resumeChat(target.chatJid);
          resolve(recovered);
        } catch (error) { reject(error); }
      }, createUuid("message-recovery"), `chat:${target.chatJid}`);
    }).finally(() => {
      if (timer) clearTimeout(timer);
      if (onAbort) req.signal.removeEventListener("abort", onAbort);
    });
    return channel.json({ recovered: true, ...result });
  } catch (error) {
    if (error instanceof ChatAccessDenied) return deny();
    return channel.json({ error: "Message recovery failed." }, 400);
  }
}
