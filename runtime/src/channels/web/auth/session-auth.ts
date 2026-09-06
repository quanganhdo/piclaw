/**
 * channels/web/session-auth.ts – Web session cookie/auth helper functions.
 */

import { deleteExpiredWebSessions, getWebSession } from "../../../db.js";

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie") || "";
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) return acc;
    try {
      acc[rawKey] = decodeURIComponent(rest.join("=") || "");
    } catch (error) {
      void error;
      acc[rawKey] = ""; // Invalid cookie encoding cannot establish an identity.
    }
    return acc;
  }, {} as Record<string, string>);
}

/** Get piclaw session token from request cookies. */
export function getSessionTokenFromRequest(req: Request): string | null {
  const cookies = parseCookies(req);
  return cookies.piclaw_session || null;
}

/** Build Set-Cookie header for web auth sessions. */
export function buildSessionCookieHeader(
  token: string,
  req: Request,
  sessionTtl: number,
  tlsConfigured: boolean
): string {
  const rawTtl = Number.isFinite(sessionTtl) ? sessionTtl : 0;
  const ttl = Math.max(60, rawTtl || 0);
  const secure = req.url.startsWith("https://") || tlsConfigured;
  const parts = [
    `piclaw_session=${encodeURIComponent(token)}`,
    `Max-Age=${ttl}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Check if request has any valid auth session. */
export function isRequestAuthenticated(req: Request, authEnabled: boolean): boolean {
  if (!authEnabled) return true;
  deleteExpiredWebSessions();
  const token = getSessionTokenFromRequest(req);
  if (!token) return false;
  return Boolean(getWebSession(token));
}

/** Check if request has a valid TOTP-authenticated session. */
export function isRequestTotpSession(req: Request, totpEnabled: boolean): boolean {
  if (!totpEnabled) return false;
  deleteExpiredWebSessions();
  const token = getSessionTokenFromRequest(req);
  if (!token) return false;
  const session = getWebSession(token);
  return Boolean(session && session.auth_method === "totp");
}
