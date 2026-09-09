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
import { requireAccountActor } from "../../../db/account-administration.js";
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

/** Family push control plane: bind subscription and presence records to the live account/login. */
export async function handleFamilyWebPush(
  channel: WebChannelLike,
  req: Request,
  principal: AuthenticatedPrincipal,
  options: { baseDir?: string; database?: Database; presenceService?: WebNotificationPresenceService; readMode?: () => string } = {},
): Promise<Response> {
  const deny = () => channel.json({ error: "Session access denied." }, 403);
  const url = new URL(req.url), path = url.pathname;
  if (url.search || !["/agent/push/vapid-public-key", "/agent/push/subscription", "/agent/push/presence"].includes(path)) return deny();
  if (req.headers.get("x-piclaw-account-id") !== principal.userId
    || req.headers.get("x-piclaw-login-id") !== principal.authentication.sessionId) return deny();
  const database = options.database ?? getDb();
  const actor = Object.freeze({ ...principal, authentication: Object.freeze({ ...principal.authentication }) });
  const validate = () => {
    if (req.signal.aborted || (options.readMode ?? (() => readAccessConfig().mode))() !== "family-shared" || getDb() !== database) throw new ChatAccessDenied();
    requireAccountActor(database, actor);
  };
  const readBody = async (): Promise<Record<string, unknown>> => {
    if (!req.body) throw new ChatAccessDenied();
    const declared = req.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 64 * 1024)) throw new ChatAccessDenied();
    const reader = req.body.getReader(), buffer = new Uint8Array(64 * 1024); let size = 0;
    let timer: ReturnType<typeof setTimeout> | undefined, abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new ChatAccessDenied()); timer = setTimeout(abort, 10_000);
      req.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      for (;;) {
        validate();
        const { done, value } = await Promise.race([reader.read(), cancelled]);
        validate();
        if (done) break;
        if (size + value.byteLength > buffer.length) throw new ChatAccessDenied();
        buffer.set(value, size); size += value.byteLength;
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChatAccessDenied();
      return value as Record<string, unknown>;
    } finally {
      clearTimeout(timer); req.signal.removeEventListener("abort", abort);
      void reader.cancel().catch(error => debugSuppressedError(log, "Push request stream already closed.", error, { operation: "family_push.cancel" }));
      try { reader.releaseLock(); } catch (error) { debugSuppressedError(log, "Push request reader release deferred.", error, { operation: "family_push.release" }); }
    }
  };
  try {
    validate();
    if (path === "/agent/push/vapid-public-key") {
      if (req.method !== "GET" && req.method !== "HEAD") return deny();
      if (req.method === "HEAD") return new Response(null, { status: 200 });
      return await handleWebPushVapidPublicKey({ baseDir: options.baseDir });
    }
    if (!req.headers.get("origin") || !checkCsrfOrigin(req)
      || req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return deny();
    if ((path === "/agent/push/subscription" && !["POST", "DELETE"].includes(req.method))
      || (path === "/agent/push/presence" && req.method !== "POST")) return deny();
    if (isRateLimitedForClient(actor.userId, "family_web_push", 60_000, 30)) return rateLimitResponse("Too many notification requests.");
    const scope = { ownerUserId: actor.userId, loginSessionId: actor.authentication.sessionId! };
    const body = await readBody();
    if (path === "/agent/push/subscription") {
      if (!Object.keys(body).every(key => ["subscription", "device_id"].includes(key))) return deny();
      const subscription = body.subscription, deviceId = resolveDeviceId(body.device_id);
      if (!deviceId || deviceId.length > 256) return deny();
      if (req.method === "POST") {
        validate();
        const stored = await upsertStoredWebPushSubscriptionAtomic(subscription, { baseDir: options.baseDir, userAgent: resolveUserAgent(req), deviceId, ...scope, allowOwnerRebind: true, validate });
        try {
          validate(); return channel.json({ ok: true, device_id: stored.deviceId });
        } catch (error) {
          await removeStoredWebPushSubscriptionAtomic(stored.endpoint, options.baseDir, { ...scope, deviceId: stored.deviceId ?? deviceId });
          throw error;
        }
      }
      if (req.method !== "DELETE") return deny();
      const endpoint = typeof (subscription as Record<string, unknown> | null)?.endpoint === "string"
        ? String((subscription as Record<string, unknown>).endpoint).trim() : "";
      if (!endpoint) return deny();
      const removed = await removeStoredWebPushSubscriptionAtomic(endpoint, options.baseDir, { ...scope, deviceId }, validate);
      validate(); return channel.json({ ok: true, removed });
    }
    if (req.method !== "POST") return deny();
    if (!Object.keys(body).every(key => ["device_id", "client_id", "chat_jid", "visibility_state", "has_focus", "active"].includes(key))) return deny();
    if (typeof body.device_id !== "string" || typeof body.client_id !== "string" || typeof body.chat_jid !== "string"
      || !["visible", "hidden"].includes(String(body.visibility_state)) || typeof body.has_focus !== "boolean"
      || (body.active !== undefined && typeof body.active !== "boolean")) return deny();
    const chatJid = typeof body?.chat_jid === "string" ? body.chat_jid.trim() : "";
    if (!chatJid) return deny();
    resolveAuthorisedChat(database, actor, chatJid, "session.read");
    validate();
    const presenceService = options.presenceService ?? webNotificationPresenceService;
    if (body.active === false) {
      const removed = presenceService.remove(body, scope); validate();
      return channel.json({ ok: true, active: false, removed });
    }
    const stored = presenceService.upsert(body, { userAgent: resolveUserAgent(req), ...scope });
    try {
      validate(); return channel.json({ ok: true, active: true, device_id: stored.deviceId, client_id: stored.clientId,
        chat_jid: stored.chatJid, visibility_state: stored.visibilityState });
    } catch (error) { presenceService.remove(body, scope); throw error; }
  } catch (error) {
    if (error instanceof ChatAccessDenied || req.signal.aborted) return deny();
    return channel.json({ error: "Notification request failed." }, 400);
  }
}
