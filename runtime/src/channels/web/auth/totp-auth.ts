/**
 * channels/web/totp-auth.ts – TOTP verification endpoint orchestration.
 */

import { getWebRuntimeConfig } from "../../../core/config.js";
import { createWebSession, DEFAULT_WEB_USER_ID, getDb } from "../../../db.js";
import { getUser } from "../../../db/users.js";
import { checkCsrfOrigin } from "../http/security.js";
import { reserveUserAuthAttempt, type VerifiedTotp } from "../../../secure/user-auth-factors.js";
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
  /** Absent only for legacy single-user callers. Auth-only service returns a verified user ID. */
  verifyUserTotp?(username: string, code: string): Promise<VerifiedTotp | null>;
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
  if (!ctx.isAuthEnabled() || !ctx.isTotpEnabled()) return ctx.json({ error: "Auth disabled" }, 404);

  let body: { code?: unknown; username?: unknown };
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

  const multiUser = ctx.accessMode !== undefined && ctx.accessMode !== "single-user";
  if (multiUser !== Boolean(ctx.verifyUserTotp)) return ctx.json({ error: "Account authentication unavailable" }, 503);
  if (multiUser && !checkCsrfOrigin(req)) return ctx.json({ error: "Origin not allowed" }, 403);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  if (ctx.verifyUserTotp && (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(username) || !/^[0-9]{6}$/.test(code))) {
    ctx.failureTracker.recordFailure(clientKey, now);
    return ctx.json({ error: "Invalid code" }, 401);
  }
  const accountKey = `account:${username}`;
  if (ctx.verifyUserTotp && ctx.failureTracker.isLocked(accountKey, now)) {
    return ctx.json({ error: "Too many failed attempts. Try again later." }, 429);
  }
  if (multiUser && !reserveUserAuthAttempt(getDb(), username, clientKey, now)) {
    return ctx.json({ error: "Too many failed attempts. Try again later." }, 429);
  }
  const verified = multiUser ? await ctx.verifyUserTotp!(username, code) : null;
  const userId = multiUser ? verified?.userId ?? null
    : verifyTotp(getWebRuntimeConfig().totpSecret, code, getTotpWindowSteps()) ? DEFAULT_WEB_USER_ID : null;
  if (!userId) {
    if (ctx.verifyUserTotp) ctx.failureTracker.recordFailure(accountKey, now);
    const failure = ctx.failureTracker.recordFailure(clientKey, now);
    if (failure.locked) {
      ctx.logAuthEvent(req, `TOTP lockout triggered (${failure.failures} failures)`);
      return ctx.json({ error: "Too many failed attempts. Try again later." }, 429);
    }
    ctx.logAuthEvent(req, `TOTP failed (${failure.failures}/${ctx.failureTracker.getFailureLimit()})`);
    return ctx.json({ error: "Invalid code" }, 401);
  }

  const token = randomSessionToken();
  const issued = getDb().transaction(() => {
    if (multiUser) {
      const user = getUser(getDb(), userId);
      if (!user?.enabled || !user.home_chat_jid || !verified) return false;
      const factor = getDb().query("SELECT revision,last_used_step FROM user_totp_factors WHERE user_id=?").get(userId) as {revision:string;last_used_step:number} | null;
      if (!factor || factor.revision !== verified.factorRevision || factor.last_used_step !== verified.step) return false;
    }
    createWebSession(token, userId, getSessionTtlSeconds(), "totp");
    return true;
  }).immediate();
  if (!issued) return ctx.json({ error: "Invalid code" }, 401);
  ctx.failureTracker.clear(clientKey);
  if (ctx.verifyUserTotp) ctx.failureTracker.clear(accountKey);

  return okJson({ ok: true }, 200, {
    "Set-Cookie": ctx.buildSessionCookie(token, req),
  });
}
