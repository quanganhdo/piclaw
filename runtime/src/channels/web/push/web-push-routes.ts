/**
 * web/push/web-push-routes.ts – HTTP handlers for VAPID key discovery and subscription persistence.
 */

import {
  getStoredVapidPublicKey,
  removeStoredWebPushSubscriptionAtomic,
  removeStoredWebPushSubscription,
  upsertStoredWebPushSubscriptionAtomic,
  upsertStoredWebPushSubscription,
} from "./web-push-store.js";
import {
  webNotificationPresenceService,
  WebNotificationPresenceService,
} from "./web-notification-presence-service.js";
import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { readAccessConfig } from "../../../core/config-access.js";
import { getDb } from "../../../db/connection.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import { checkCsrfOrigin, rateLimitResponse } from "../http/security.js";
import { isRateLimitedForClient } from "../http/rate-limit.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.push.routes");

function resolveUserAgent(req: Request): string | null {
  const value = req.headers.get("user-agent");
  return value && value.trim() ? value.trim() : null;
}

function resolveDeviceId(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

export async function handleWebPushVapidPublicKey(options: { baseDir?: string } = {}): Promise<Response> {
  return Response.json({ publicKey: getStoredVapidPublicKey(options.baseDir) });
}

export async function handleWebPushSubscriptionUpsert(req: Request, options: { baseDir?: string } = {}): Promise<Response> {
  try {
    const body = await req.json().catch(() => null);
    const subscription = body && typeof body === "object" && body.subscription ? body.subscription : body;
    const stored = upsertStoredWebPushSubscription(subscription, {
      baseDir: options.baseDir,
      userAgent: resolveUserAgent(req),
      deviceId: resolveDeviceId((body as Record<string, unknown> | null)?.device_id ?? (body as Record<string, unknown> | null)?.deviceId),
    });
    return Response.json({ ok: true, device_id: stored.deviceId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid push subscription." }, { status: 400 });
  }
}

export async function handleWebPushSubscriptionDelete(req: Request, options: { baseDir?: string } = {}): Promise<Response> {
  const body = await req.json().catch(() => null);
  const subscription = body && typeof body === "object" && body.subscription ? body.subscription : body;
  const endpoint = typeof subscription?.endpoint === "string"
    ? subscription.endpoint.trim()
    : typeof body?.endpoint === "string"
      ? body.endpoint.trim()
      : "";

  if (!endpoint) {
    return Response.json({ error: "Missing push subscription endpoint." }, { status: 400 });
  }

  const removed = removeStoredWebPushSubscription(endpoint, options.baseDir);
  return Response.json({ ok: true, removed });
}

export async function handleWebPushPresence(
  req: Request,
  options: { presenceService?: WebNotificationPresenceService } = {},
): Promise<Response> {
  try {
    const body = await req.json().catch(() => null);
    const payload = body && typeof body === "object" ? body as Record<string, unknown> : null;
    if (!payload) {
      return Response.json({ error: "Invalid web notification presence payload." }, { status: 400 });
    }

    const presenceService = options.presenceService || webNotificationPresenceService;
    if (payload.active === false) {
      const removed = presenceService.remove(payload);
      return Response.json({ ok: true, active: false, removed });
    }

    const stored = presenceService.upsert(payload, { userAgent: resolveUserAgent(req) });
    return Response.json({
      ok: true,
      active: true,
      device_id: stored.deviceId,
      client_id: stored.clientId,
      chat_jid: stored.chatJid,
      visibility_state: stored.visibilityState,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid web notification presence payload." }, { status: 400 });
  }
}
