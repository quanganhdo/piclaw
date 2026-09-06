/**
 * web/auth.ts – TOTP-based authentication for the web UI.
 *
 * Implements HMAC-based TOTP (RFC 6238) verification, session token
 * generation, and cookie-based session management. When WEB_TOTP_SECRET
 * is configured, all web requests must be authenticated.
 *
 * Consumers: channels/web.ts uses these helpers in its request handler
 *            to gate access to all API and static endpoints.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): Buffer | null {
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (!clean) return null;

  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  if (bytes.length === 0) return null;
  return Buffer.from(bytes);
}

function decodeSecret(secret: string): Buffer {
  const decoded = decodeBase32(secret);
  return decoded ?? Buffer.from(secret, "utf8");
}

function totpAtTime(secret: string, stepSeconds: number, digits: number, timeMs: number): string {
  const key = decodeSecret(secret);
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return (code % mod).toString().padStart(digits, "0");
}

/** Verify a 6-digit TOTP code against the configured secret. */
export function verifyTotp(secret: string, code: string, windowSteps = 1, stepSeconds = 30, digits = 6): boolean {
  const normalized = code.replace(/\D/g, "").slice(0, digits);
  if (normalized.length !== digits) return false;

  const now = Date.now();
  let valid = false;
  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const expected = totpAtTime(secret, stepSeconds, digits, now + offset * stepSeconds * 1000);
    // Constant-time comparison to prevent timing side-channels.
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(normalized, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      valid = true;
    }
  }
  return valid;
}

/** Strict per-account TOTP verification returning the accepted step for atomic replay protection. */
export function matchTotpStep(secret: string, code: string, nowMs = Date.now(), windowSteps = 1): number | null {
  if (!/^[0-9]{6}$/.test(code) || !Number.isSafeInteger(nowMs) || nowMs < 0
    || !Number.isInteger(windowSteps) || windowSteps < 0 || windowSteps > 2) return null;
  const current = Math.floor(nowMs / 30_000);
  let matched: number | null = null;
  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const step = current + offset;
    if (step < 0) continue;
    if (safeEqual(totpAtTime(secret, 30, 6, step * 30_000), code)) matched = step;
  }
  return matched;
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Generate a cryptographically random hex session token. */
export function randomSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
