/**
 * channels/web/auth-runtime.ts – web auth mode evaluation + auth context builders.
 */

import {
  buildSessionCookieHeader,
  isRequestAuthenticated,
  isRequestTotpSession,
} from "./session-auth.js";
import { isInternalSecretRequestAuthorized } from "./internal-secret.js";
import type { TotpAuthContext, TotpFailureTrackerLike } from "./totp-auth.js";
import type { WebauthnAuthContext } from "./webauthn-auth.js";
import type { WebauthnEnrolPageContext } from "./webauthn-enrol-page.js";
import type { WebauthnChallengeTracker } from "./webauthn-challenges.js";

/** Runtime auth feature flags and cookie settings derived from config/env. */
export interface WebAuthRuntimeConfig {
  accessMode?: import("../../../core/config-access.js").AccessMode;
  passkeyMode: string;
  totpSecret: string;
  internalSecret: string;
  sessionTtlSeconds: number;
  hasTls: boolean;
}

/** Return true when TOTP auth is configured with a non-empty shared secret. */
export function isTotpEnabled(config: WebAuthRuntimeConfig): boolean {
  if (config.accessMode && config.accessMode !== "single-user") return !isPasskeyOnly(config);
  return Boolean(config.totpSecret && config.totpSecret.trim());
}

/** Return true when passkeys are enabled by mode/secret policy. */
export function isPasskeyEnabled(config: WebAuthRuntimeConfig): boolean {
  const mode = (config.passkeyMode || "").toLowerCase();
  if (mode === "totp-only") return false;
  if (mode === "passkey-only") return true;
  return isTotpEnabled(config);
}

/** Return true when passkey-only mode is explicitly selected. */
export function isPasskeyOnly(config: WebAuthRuntimeConfig): boolean {
  return (config.passkeyMode || "").toLowerCase() === "passkey-only";
}

/** Return true when either TOTP or passkey auth is active. */
export function isAuthEnabled(config: WebAuthRuntimeConfig): boolean {
  return (config.accessMode !== undefined && config.accessMode !== "single-user")
    || isTotpEnabled(config) || isPasskeyEnabled(config);
}

/** Return true when internal-secret authentication is configured. */
export function isInternalSecretEnabled(config: WebAuthRuntimeConfig): boolean {
  return Boolean(config.internalSecret && config.internalSecret.trim());
}

/** Check whether a request is currently in the temporary TOTP session state. */
export function isTotpSession(req: Request, config: WebAuthRuntimeConfig): boolean {
  return isRequestTotpSession(req, isTotpEnabled(config));
}

/** Validate the request-level internal secret header/bearer token. */
export function verifyInternalSecret(req: Request, config: WebAuthRuntimeConfig): boolean {
  return isInternalSecretRequestAuthorized(req, config.internalSecret || "");
}

/** Check whether the request is authenticated for routes requiring web auth. */
export function isAuthenticated(req: Request, config: WebAuthRuntimeConfig): boolean {
  return isRequestAuthenticated(req, isAuthEnabled(config));
}

/** Build the session cookie header value using runtime TTL/TLS settings. */
export function buildSessionCookie(token: string, req: Request, config: WebAuthRuntimeConfig): string {
  return buildSessionCookieHeader(token, req, config.sessionTtlSeconds, config.hasTls);
}

interface AuthContextDeps {
  json(payload: unknown, status?: number): Response;
  getClientKey(req: Request): string;
  logAuthEvent(req: Request, event: string): void;
}

interface TotpAuthContextDeps extends AuthContextDeps {
  failureTracker: TotpFailureTrackerLike;
}

interface WebauthnAuthContextDeps extends AuthContextDeps {
  challenges: WebauthnChallengeTracker;
}

/** Build the dependency context consumed by TOTP auth handlers. */
export function createTotpAuthContext(
  config: WebAuthRuntimeConfig,
  deps: TotpAuthContextDeps
): TotpAuthContext {
  return {
    accessMode: config.accessMode ?? "single-user",
    isAuthEnabled: () => isAuthEnabled(config),
    isTotpEnabled: () => isTotpEnabled(config),
    json: deps.json,
    getClientKey: deps.getClientKey,
    logAuthEvent: deps.logAuthEvent,
    buildSessionCookie: (token, req) => buildSessionCookie(token, req, config),
    failureTracker: deps.failureTracker,
  };
}

/** Build the dependency context consumed by WebAuthn auth endpoints. */
export function createWebauthnAuthContext(
  config: WebAuthRuntimeConfig,
  deps: WebauthnAuthContextDeps
): WebauthnAuthContext {
  return {
    accessMode: config.accessMode ?? "single-user",
    isPasskeyEnabled: () => isPasskeyEnabled(config),
    json: deps.json,
    buildSessionCookie: (token, req) => buildSessionCookie(token, req, config),
    logAuthEvent: deps.logAuthEvent,
    getClientKey: deps.getClientKey,
    challenges: deps.challenges,
  };
}

/** Build the dependency context consumed by the passkey enrol page route. */
export function createWebauthnEnrolPageContext(
  config: WebAuthRuntimeConfig,
  deps: Pick<AuthContextDeps, "json">
): WebauthnEnrolPageContext {
  return {
    isPasskeyEnabled: () => isPasskeyEnabled(config),
    json: deps.json,
  };
}
