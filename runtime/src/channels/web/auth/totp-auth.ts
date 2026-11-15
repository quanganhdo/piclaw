import { getDb } from "../../../db/connection.js";
import { admitSqliteWrite } from "../../../db/sqlite-async-admission.js";
/**
 * channels/web/totp-auth.ts – TOTP verification endpoint orchestration.
 */

import { getWebRuntimeConfig } from "../../../core/config.js";
import { createWebSession, DEFAULT_WEB_USER_ID } from "../../../db.js";
import { okJson } from "../http/http-utils.js";
import { randomSessionToken, verifyTotp } from "./auth.js";

/** Minimal lockout-tracker contract consumed by TOTP auth handler logic. */
export interface TotpFailureTrackerLike {
  isLocked(clientKey: string, now: number): boolean;
  recordFailure(clientKey: string, now: number): { locked: boolean; failures: number };
  clear(clientKey: string): void;
  getFailureLimit(): number;
}

/** Runtime dependencies required by the TOTP verification endpoint. */
export interface TotpAuthContext {
  accessMode?: import("../../../core/config-access.js").AccessMode;
  isAuthEnabled(): boolean;
  isTotpEnabled(): boolean;
  json(payload: unknown, status?: number): Response;
  getClientKey(req: Request): string;
  logAuthEvent(req: Request, event: string): void;
  buildSessionCookie(token: string, req: Request): string;
  failureTracker: TotpFailureTrackerLike;
}

function getTotpWindowSteps(): number {
  const rawWindow = getWebRuntimeConfig().totpWindow;
  return Number.isFinite(rawWindow) ? Math.max(0, rawWindow) : 1;
}

function getSessionTtlSeconds(): number {
  const rawTtl = getWebRuntimeConfig().sessionTtl;
  return Math.max(60, rawTtl || 0);
}

/** Verify a submitted TOTP code, enforce lockout policy, and issue a web session. */
export async function handleAuthVerifyRequest(req: Request, ctx: TotpAuthContext): Promise<Response> {
  if (ctx.accessMode && ctx.accessMode !== "single-user") return ctx.json({ error: "Account authentication unavailable" }, 503);
  if (!ctx.isAuthEnabled() || !ctx.isTotpEnabled()) return ctx.json({ error: "Auth disabled" }, 404);

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return ctx.json({ error: "Invalid JSON" }, 400);
  }

  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) return ctx.json({ error: "Missing code" }, 400);

  const now = Date.now();
  const clientKey = ctx.getClientKey(req);
  if (ctx.failureTracker.isLocked(clientKey, now)) {
    ctx.logAuthEvent(req, "TOTP lockout active");
    return ctx.json({ error: "Too many failed attempts. Try again later." }, 429);
  }

  const secret = getWebRuntimeConfig().totpSecret;
  const userId = verifyTotp(secret, code, getTotpWindowSteps()) ? DEFAULT_WEB_USER_ID : null;
  if (!userId) {
    const failure = ctx.failureTracker.recordFailure(clientKey, now);
    if (failure.locked) {
      ctx.logAuthEvent(req, `TOTP lockout triggered (${failure.failures} failures)`);
      return ctx.json({ error: "Too many failed attempts. Try again later." }, 429);
    }
    ctx.logAuthEvent(req, `TOTP failed (${failure.failures}/${ctx.failureTracker.getFailureLimit()})`);
    return ctx.json({ error: "Invalid code" }, 401);
  }

  const token = randomSessionToken();
  const issued = await admitSqliteWrite(getDb(), () => {
    if (!ctx.isAuthEnabled() || !ctx.isTotpEnabled() || getWebRuntimeConfig().totpSecret !== secret) return false;
    createWebSession(token, userId, getSessionTtlSeconds(), "totp"); return true;
  }, undefined, req.signal);
  if (!issued) return ctx.json({ error: "Authentication changed; retry sign-in." }, 401);
  ctx.failureTracker.clear(clientKey);

  return okJson({ ok: true }, 200, {
    "Set-Cookie": ctx.buildSessionCookie(token, req),
  });
}
