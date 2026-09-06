/**
 * web/sse.ts – Server-Sent Events (SSE) primitives.
 *
 * Provides low-level SSE stream creation, event encoding, client
 * lifecycle management, and broadcast helpers.
 *
 * Consumers: web/sse-hub.ts builds on these primitives.
 */

import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { getAppAssetVersion } from "../http/static.js";
import { getServerUiState } from "../ui-state.js";

const log = createLogger("web.sse");
const encoder = new TextEncoder();

const CHAT_SCOPED_EVENT_TYPES = new Set([
  "agent_status",
  "agent_thought",
  "agent_thought_delta",
  "agent_draft",
  "agent_draft_delta",
  "agent_preview_consumed",
  "agent_response",
  "new_post",
  "new_reply",
  "interaction_updated",
  "interaction_deleted",
  "agent_steer_queued",
  "agent_followup_queued",
  "agent_followup_consumed",
  "agent_followup_removed",
  "model_changed",
  "extension_ui_timeout",
  "extension_ui_request",
  "extension_ui_notify",
  "extension_ui_status",
  "extension_ui_working",
  "extension_ui_working_indicator",
  "extension_ui_working_visible",
  "extension_ui_widget",
  "extension_ui_title",
  "extension_ui_editor_text",
  "extension_ui_error",
  "generated_widget_open",
  "generated_widget_delta",
  "generated_widget_final",
  "generated_widget_close",
  "generated_widget_error",
]);

export function requiresChatScopedDelivery(eventType: string): boolean {
  return CHAT_SCOPED_EVENT_TYPES.has(String(eventType || "").trim());
}

/**
 * Maximum number of concurrent SSE clients.
 * Prevents resource exhaustion from opening too many connections.
 * Each client holds a ReadableStream controller and a heartbeat interval.
 */
const MAX_SSE_CLIENTS = 50;

/** Server-created subscription authority; never populated from request payloads. */
export interface SseAuthorisation {
  readonly chatJid: string;
  readonly isAuthorised: () => boolean;
}

function isAuthorised(authorisation?: SseAuthorisation): boolean {
  if (!authorisation) return true;
  try { return Boolean(authorisation.chatJid && authorisation.isAuthorised()); }
  catch { return false; }
}

/** An SSE client waiting to be registered (response + controller). */
export interface PendingClient {
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: Timer;
  chatJid?: string | null;
  authorisation?: SseAuthorisation;
}

/** Interface for a container that holds SSE client lists. */
export interface SseClientContainer {
  clients: Set<PendingClient>;
}

/**
 * Create an SSE response stream and register the client.
 * Returns 503 if the maximum client limit has been reached.
 */
export function handleSse(channel: SseClientContainer, req?: Request, authorisation?: SseAuthorisation): Response {
  if (!isAuthorised(authorisation)) {
    return new Response(JSON.stringify({ error: "Session access denied." }), {
      status: 403, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    });
  }
  // Guard against connection exhaustion — reject if at capacity
  if (channel.clients.size >= MAX_SSE_CLIENTS) {
    return new Response(JSON.stringify({ error: "Too many connections" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  let clientRef: PendingClient | null = null;
  const chatJid = authorisation?.chatJid ?? (req ? (new URL(req.url).searchParams.get("chat_jid") || "").trim() || null : null);

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const heartbeat = setInterval(() => {
        if (clientRef && !revalidateSseClient(channel, clientRef)) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
          controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now(), ...(chatJid ? { chat_jid: chatJid } : {}) })}\n\n`));
        } catch {
          clearInterval(heartbeat);
          if (clientRef) channel.clients.delete(clientRef);
        }
      }, 30000);
      clientRef = { controller, heartbeat, chatJid, authorisation };
      channel.clients.add(clientRef);
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ app_asset_version: getAppAssetVersion(), ...(authorisation ? {} : getServerUiState()), ...(chatJid ? { chat_jid: chatJid } : {}) })}\n\n`));
    },
    cancel: () => {
      if (clientRef) {
        clearInterval(clientRef.heartbeat);
        channel.clients.delete(clientRef);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": authorisation ? "private, no-store" : "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Revoke before delivery and on the heartbeat, including silent/idle connections. */
export function revalidateSseClient(channel: SseClientContainer, client: PendingClient): boolean {
  if (isAuthorised(client.authorisation)) return true;
  clearInterval(client.heartbeat);
  channel.clients.delete(client);
  try { client.controller.close(); }
  catch (error) { debugSuppressedError(log, "Revoked SSE client already closed.", error); }
  return false;
}

/** Encode and send an SSE event to all connected clients. */
export function broadcastEvent(channel: SseClientContainer, eventType: string, data: unknown): void {
  const eventChatJid = data && typeof data === "object" && typeof (data as Record<string, unknown>).chat_jid === "string"
    ? String((data as Record<string, unknown>).chat_jid || "").trim() || null
    : null;

  if (requiresChatScopedDelivery(eventType) && !eventChatJid) {
    log.warn("Dropping chat-scoped event without chat_jid", {
      operation: "web_sse.broadcast_event.missing_chat_jid",
      eventType,
    });
    return;
  }

  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  const bytes = encoder.encode(payload);
  for (const client of channel.clients) {
    if (!revalidateSseClient(channel, client)) continue;
    // No global broadcast payloads or unknown event types are approved for family clients.
    if (client.authorisation && (!eventChatJid || !requiresChatScopedDelivery(eventType))) continue;
    if (eventChatJid && client.chatJid !== eventChatJid) {
      continue;
    }
    try {
      client.controller.enqueue(bytes);
    } catch {
      clearInterval(client.heartbeat);
      channel.clients.delete(client);
    }
  }
}
