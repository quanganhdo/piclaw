import { getDb } from "../../../db/connection.js";
import {
  readPickerPins,
  changePickerPins,
  parsePinChange,
} from "../../../db/picker-pins.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { resolveAuthorisedChat } from "../../../db/session-ownership.js";
import { getChatBranchByChatJid } from "../../../db/chat-branches.js";
import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { enforceBrowserBinding } from "../auth/browser-binding.js";
import { checkCsrfOrigin } from "../http/security.js";
import { isRateLimitedForClient } from "../http/rate-limit.js";
import { createLogger } from "../../../utils/logger.js";
const log = createLogger("web.picker-pins");

async function readPinBody(req: Request): Promise<unknown> {
  if (!req.body) throw Error("Missing pin body.");
  const reader = req.body.getReader(),
    buffer = new Uint8Array(300000);
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error("Pin body timed out.")), 10000);
  });
  try {
    for (;;) {
      if (req.signal.aborted) throw Error("Pin request aborted.");
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (size + value.byteLength > buffer.length)
        throw Error("Pin body too large.");
      buffer.set(value, size);
      size += value.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, size),
      ),
    );
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() =>
      log.debug("Pin request stream already closed", {
        operation: "picker_pins.cancel",
      }),
    );
    reader.releaseLock();
  }
}

export async function handlePickerPins(
  req: Request,
  channel: WebChannelLike,
  actor?: AuthenticatedPrincipal,
): Promise<Response> {
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  const url = new URL(req.url);
  if (url.search || !["GET", "POST"].includes(req.method))
    return reply({ error: "Invalid pin request." }, 400);
  const db = getDb();
  if (
    actor &&
    (!req.headers.get("x-piclaw-account-id") ||
      !req.headers.get("x-piclaw-login-id"))
  )
    return reply({ error: "Account binding required." }, 409);
  if (actor) {
    const denied = enforceBrowserBinding(req, actor);
    if (denied) return denied;
    try {
      requireAccountActor(db, actor);
    } catch {
      return reply({ error: "Account access denied." }, 403);
    }
  }
  if (
    req.method === "POST" &&
    (!req.headers.get("origin") || !checkCsrfOrigin(req))
  )
    return reply({ error: "Invalid origin." }, 403);
  const owner = actor ? "user:" + actor.userId : "operator";
  const canRead = (jid: string) => {
    try {
      if (actor) resolveAuthorisedChat(db, actor, jid, "session.read");
      else if (!getChatBranchByChatJid(jid)) return false;
      return true;
    } catch {
      return false;
    }
  };
  if (req.method === "GET") return reply(readPickerPins(db, owner, canRead));
  if (isRateLimitedForClient(owner, "picker-pins", 60000, 120))
    return reply({ error: "Too many pin changes. Try again shortly." }, 429);
  let change;
  try {
    change = parsePinChange(await readPinBody(req));
  } catch {
    return reply({ error: "Invalid pin action." }, 400);
  }
  try {
    // Body reading is asynchronous; revalidate identity before the transaction.
    if (actor) requireAccountActor(db, actor);
    const state = changePickerPins(db, owner, change, canRead);
    // Invalidation only: no session/model identifiers or account data on SSE.
    channel.broadcastEvent(
      "picker_pins_changed",
      actor ? { user_id: actor.userId } : { operator: true },
    );
    return reply(state);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pin update failed.";
    return reply(
      { error: message.includes("limit") ? message : "Pin update denied." },
      message.includes("limit") ? 400 : 403,
    );
  }
}
