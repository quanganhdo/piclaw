/**
 * channels/web/webauthn-challenges.ts – transient WebAuthn challenge tracking and helpers.
 */

import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { getRequestOriginParts } from "../http/client.js";

/** In-memory challenge entry for pending WebAuthn login/registration flows. */
export type PendingWebauthnChallenge = {
  /** Base64url-encoded challenge value issued to the client ceremony. */
  challenge: string;
  /** Relying-party id associated with the challenge. */
  rpId: string;
  /** User id associated with the challenge. */
  userId: string | null;
  /** Expected origin captured at ceremony creation. */
  origin?: string;
  /** Epoch timestamp (ms) when the challenge was created. */
  createdAt: number;
};

const DEFAULT_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const log = createLogger("web.webauthn-challenges");

/** Tracks pending login/registration WebAuthn challenges with TTL-based pruning. */
export class WebauthnChallengeTracker {
  private readonly pendingRegistrations = new Map<string, PendingWebauthnChallenge>();
  private readonly pendingLogins = new Map<string, PendingWebauthnChallenge>();

  constructor(private readonly ttlMs = DEFAULT_CHALLENGE_TTL_MS) {}

  private prune(now = Date.now()): void {
    const cutoff = now - this.ttlMs;

    for (const [token, entry] of this.pendingRegistrations.entries()) {
      if (entry.createdAt < cutoff) this.pendingRegistrations.delete(token);
    }

    for (const [token, entry] of this.pendingLogins.entries()) {
      if (entry.createdAt < cutoff) this.pendingLogins.delete(token);
    }
  }

  /**
   * Track a pending WebAuthn login challenge.
   * @param token Challenge token key used for lookup.
   * @param value Challenge payload excluding creation timestamp.
   * @param now Optional timestamp override for deterministic tests.
   * @returns Nothing.
   */
  trackLogin(token: string, value: Omit<PendingWebauthnChallenge, "createdAt">, now = Date.now()): void {
    this.prune(now);
    this.pendingLogins.set(token, { ...value, createdAt: now });
  }

  /**
   * Consume and remove a pending WebAuthn login challenge.
   * @param token Challenge token key used for lookup.
   * @param now Optional timestamp override for deterministic tests.
   * @returns The pending challenge when found, otherwise null.
   */
  consumeLogin(token: string, now = Date.now()): PendingWebauthnChallenge | null {
    this.prune(now);
    const entry = this.pendingLogins.get(token);
    if (!entry) return null;
    this.pendingLogins.delete(token);
    return entry;
  }

  /**
   * Track a pending WebAuthn registration challenge.
   * @param token Challenge token key used for lookup.
   * @param value Challenge payload excluding creation timestamp.
   * @param now Optional timestamp override for deterministic tests.
   * @returns Nothing.
   */
  trackRegistration(token: string, value: Omit<PendingWebauthnChallenge, "createdAt">, now = Date.now()): void {
    this.prune(now);
    this.pendingRegistrations.set(token, { ...value, createdAt: now });
  }

  /**
   * Read a pending WebAuthn registration challenge without consuming it.
   * @param token Challenge token key used for lookup.
   * @param now Optional timestamp override for deterministic tests.
   * @returns The pending challenge when found, otherwise null.
   */
  getRegistration(token: string, now = Date.now()): PendingWebauthnChallenge | null {
    this.prune(now);
    return this.pendingRegistrations.get(token) ?? null;
  }

  /**
   * Consume and remove a pending WebAuthn registration challenge.
   * @param token Challenge token key used for lookup.
   * @param now Optional timestamp override for deterministic tests.
   * @returns The pending challenge when found, otherwise null.
   */
  consumeRegistration(token: string, now = Date.now()): PendingWebauthnChallenge | null {
    this.prune(now);
    const entry = this.pendingRegistrations.get(token);
    if (!entry) return null;
    this.pendingRegistrations.delete(token);
    return entry;
  }
}

/**
 * Resolve RP id and origin tuple for WebAuthn ceremony options.
 * @param req Incoming HTTP request providing host/origin context.
 * @returns RP id + origin tuple used by WebAuthn option builders.
 */
export function resolveWebauthnRpInfo(req: Request): { rpId: string; origin: string } {
  const url = new URL(req.url);
  const originHeader = req.headers.get("origin");

  if (originHeader && originHeader !== "null") {
    try {
      const originUrl = new URL(originHeader);
      return { rpId: originUrl.hostname, origin: originUrl.origin };
    } catch (error) {
      debugSuppressedError(log, "Ignoring invalid WebAuthn Origin header; falling back to the request origin.", error, {
        originHeader,
      });
    }
  }

  const { proto, host } = getRequestOriginParts(req);
  const rpId = host ? host.split(":")[0] : url.hostname;
  const origin = `${proto}://${host || url.host}`;
  return { rpId, origin };
}

/**
 * Encode binary bytes as base64url for WebAuthn JSON payloads.
 * @param value Raw bytes to encode.
 * @returns Base64url-encoded string.
 */
export function bufferToBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Decode a base64url string into binary bytes for WebAuthn verification.
 * @param value Base64url-encoded input string.
 * @returns Decoded byte buffer.
 */
export function base64UrlToBuffer(value: string): Uint8Array<ArrayBuffer> {
  return Buffer.from(value, "base64url") as Uint8Array<ArrayBuffer>;
}
