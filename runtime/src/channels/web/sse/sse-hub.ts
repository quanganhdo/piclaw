/**
 * web/sse-hub.ts – SSE client connection manager.
 *
 * Manages the set of connected SSE clients and provides broadcast()
 * to push events to all of them simultaneously.
 *
 * Consumers: channels/web.ts creates a single SseHub and uses it
 *            throughout the web channel for real-time event delivery.
 */

import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { broadcastEvent, handleSse, type PendingClient, type SseClientContainer, type SseAuthorisation } from "./sse.js";

const log = createLogger("web.sse-hub");

/** Manages SSE client connections and provides broadcast(). */
export class SseHub implements SseClientContainer {
  clients = new Set<PendingClient>();

  handleRequest(req?: Request, authorisation?: SseAuthorisation): Response {
    return handleSse(this, req, authorisation);
  }

  broadcast(eventType: string, data: unknown): void {
    broadcastEvent(this, eventType, data);
  }

  closeAll(): void {
    for (const client of this.clients) {
      clearInterval(client.heartbeat);
      try {
        client.controller.close();
      } catch (error) {
        debugSuppressedError(log, "Failed to close an SSE client controller during shutdown.", error);
      }
    }
    this.clients.clear();
  }
}
