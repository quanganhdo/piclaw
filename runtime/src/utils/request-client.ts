/**
 * request-client.ts – Helpers for deriving client/request metadata safely.
 *
 * Forwarded headers are only trusted when `WEB_RUNTIME_CONFIG.trustProxy` is enabled.
 */

import { getWebRuntimeConfig } from "../core/config.js";

/** Return first token from comma-separated forwarded header values. */
export function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  return value.split(",")[0]?.trim() || null;
}

function stripOptionalQuotes(value: string): string {
  return value.replace(/^"|"$/g, "").trim();
}

function parseForwardedHeader(value: string | null): { proto: string | null; host: string | null } {
  const first = firstHeaderValue(value);
  if (!first) return { proto: null, host: null };

  let proto: string | null = null;
  let host: string | null = null;
  for (const part of first.split(";")) {
    const [rawKey, ...rawRest] = part.split("=");
    const key = rawKey?.trim().toLowerCase();
    const joined = rawRest.join("=").trim();
    if (!key || !joined) continue;
    const next = stripOptionalQuotes(joined);
    if (!next) continue;
    if (key === "proto") proto = next;
    if (key === "host") host = next;
  }

  return { proto, host };
}

/** Derive a client key (IP-like token) for logging/rate limiting. */
export function getClientKey(req: Request, trustProxy = getWebRuntimeConfig().trustProxy): string {
  if (trustProxy) {
    const forwarded = firstHeaderValue(req.headers.get("x-forwarded-for"));
    if (forwarded) return forwarded;

    const realIp = firstHeaderValue(req.headers.get("x-real-ip"));
    if (realIp) return realIp;
  }

  return "unknown";
}

/**
 * Resolve externally-visible origin fields for URL generation.
 * Uses forwarded host/proto only when `WEB_RUNTIME_CONFIG.trustProxy` is enabled.
 */
/** HTTPS on the direct request or the externally visible trusted-proxy origin. */
export function isSecureWebRequest(req: Request, trustProxy = getWebRuntimeConfig().trustProxy): boolean {
  return new URL(req.url).protocol === 'https:' || getRequestOriginParts(req, trustProxy).proto.toLowerCase() === 'https';
}

export function getRequestOriginParts(req: Request, trustProxy = getWebRuntimeConfig().trustProxy): { proto: string; host: string } {
  const url = new URL(req.url);

  const forwarded = trustProxy ? parseForwardedHeader(req.headers.get("forwarded")) : { proto: null, host: null };
  const forwardedProto = trustProxy
    ? firstHeaderValue(req.headers.get("x-forwarded-proto")) || forwarded.proto
    : null;
  const forwardedHost = trustProxy
    ? firstHeaderValue(req.headers.get("x-forwarded-host")) || forwarded.host
    : null;
  const forwardedPort = trustProxy ? firstHeaderValue(req.headers.get("x-forwarded-port")) : null;

  const proto = forwardedProto || url.protocol.replace(":", "") || "http";
  let host = forwardedHost || req.headers.get("host") || url.host;

  if (forwardedPort && host && !host.includes(":")) {
    if ((proto === "https" && forwardedPort !== "443") || (proto === "http" && forwardedPort !== "80")) {
      host = `${host}:${forwardedPort}`;
    }
  }

  return { proto, host };
}
