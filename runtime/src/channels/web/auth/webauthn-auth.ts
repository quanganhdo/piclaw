/**
 * channels/web/webauthn-auth.ts – WebAuthn login/registration endpoint orchestration.
 */

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import {
  createWebSession,
  DEFAULT_WEB_USER_ID,
  consumeWebauthnEnrollment,
  getWebauthnEnrollment,
  getWebauthnCredentialById,
  getWebauthnCredentialsForRpId,
  storeWebauthnCredential,
  updateWebauthnCredentialCounter,
} from "../../../db.js";
import { getIdentityConfig, getWebRuntimeConfig } from "../../../core/config.js";
import { okJson } from "../http/http-utils.js";
import { randomSessionToken } from "./auth.js";
import {
  base64UrlToBuffer,
  bufferToBase64Url,
  resolveWebauthnRpInfo,
  type WebauthnChallengeTracker,
} from "./webauthn-challenges.js";
import { createLogger } from "../../../utils/logger.js";
import { getDb } from "../../../db/connection.js";
import { getUser } from "../../../db/users.js";
import type { AccessMode } from "../../../core/config-access.js";
import { checkCsrfOrigin } from "../http/security.js";

const log = createLogger("web.webauthn-auth");

type WebauthnServerModule = typeof import("@simplewebauthn/server");

let webauthnServerPromise: Promise<WebauthnServerModule> | null = null;

async function loadWebauthnServer(): Promise<WebauthnServerModule> {
  if (!webauthnServerPromise) {
    webauthnServerPromise = import("@simplewebauthn/server");
  }
  return await webauthnServerPromise;
}

/** Context contract consumed by WebAuthn login/register endpoint handlers. */
export interface WebauthnAuthContext {
  accessMode?: AccessMode;
  authoriseEnrolment?(req: Request, userId: string): boolean;
  isPasskeyEnabled(): boolean;
  json(payload: unknown, status?: number): Response;
  buildSessionCookie(token: string, req: Request): string;
  logAuthEvent(req: Request, event: string): void;
  getClientKey(req: Request): string;
  challenges: WebauthnChallengeTracker;
  now?: () => number;
  randomToken?: () => string;
}

function getTtlSeconds(): number {
  const rawTtl = getWebRuntimeConfig().sessionTtl;
  return Math.max(60, rawTtl || 0);
}

/** Start a passkey login ceremony and store a pending challenge token. */
export async function handleWebauthnLoginStart(req: Request, ctx: WebauthnAuthContext): Promise<Response> {
  if (!ctx.isPasskeyEnabled()) return ctx.json({ error: "Passkeys disabled" }, 404);

  if (ctx.accessMode && ctx.accessMode !== "single-user" && !checkCsrfOrigin(req)) return ctx.json({ error: "Origin not allowed" }, 403);
  const { generateAuthenticationOptions } = await loadWebauthnServer();
  const { rpId, origin } = resolveWebauthnRpInfo(req);
  const multiUser = ctx.accessMode !== undefined && ctx.accessMode !== "single-user";
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: multiUser ? "required" : "preferred",
  });

  const now = (ctx.now ?? Date.now)();
  const challengeToken = (ctx.randomToken ?? randomSessionToken)();
  ctx.challenges.trackLogin(
    challengeToken,
    {
      challenge: options.challenge,
      rpId,
      userId: multiUser ? null : DEFAULT_WEB_USER_ID,
      origin,
    },
    now
  );

  return ctx.json({ token: challengeToken, options });
}

/** Finish a passkey login ceremony and issue a web session cookie on success. */
export async function handleWebauthnLoginFinish(req: Request, ctx: WebauthnAuthContext): Promise<Response> {
  if (!ctx.isPasskeyEnabled()) return ctx.json({ error: "Passkeys disabled" }, 404);

  let body: { token?: string; credential?: AuthenticationResponseJSON };
  try {
    body = await req.json();
  } catch {
    return ctx.json({ error: "Invalid JSON" }, 400);
  }

  const token = body.token || "";
  const credential = body.credential;
  if (!token || !credential) {
    ctx.logAuthEvent(req, "WebAuthn login missing credential payload");
    return ctx.json({ error: "Missing credential" }, 400);
  }

  const pending = ctx.challenges.consumeLogin(token, (ctx.now ?? Date.now)());
  if (!pending) {
    ctx.logAuthEvent(req, "WebAuthn login expired or unknown token");
    return ctx.json({ error: "Login expired" }, 400);
  }

  if (ctx.accessMode && ctx.accessMode !== "single-user" && !checkCsrfOrigin(req)) return ctx.json({ error: "Origin not allowed" }, 403);
  const stored = getWebauthnCredentialById(credential.id);
  if (!stored || stored.rp_id !== pending.rpId) {
    ctx.logAuthEvent(req, "WebAuthn login unknown credential");
    return ctx.json({ error: "Unknown credential" }, 400);
  }

  const multiUser = ctx.accessMode !== undefined && ctx.accessMode !== "single-user";
  const account = getUser(getDb(), stored.user_id);
  const userHandle = credential.response?.userHandle;
  if ((pending.userId !== null && pending.userId !== stored.user_id)
    || (!multiUser && stored.user_id !== DEFAULT_WEB_USER_ID)
    || !account?.enabled || (multiUser && !account.home_chat_jid)
    || (userHandle && Buffer.from(userHandle, "base64url").toString("utf8") !== stored.user_id)) {
    return ctx.json({ error: "Passkey verification failed" }, 401);
  }

  const credentialRecord: WebAuthnCredential = {
    id: stored.credential_id,
    publicKey: base64UrlToBuffer(stored.public_key),
    counter: stored.sign_count || 0,
    transports: stored.transports ? JSON.parse(stored.transports) : undefined,
  };

  const { verifyAuthenticationResponse } = await loadWebauthnServer();
  const { origin } = resolveWebauthnRpInfo(req);
  let result: VerifiedAuthenticationResponse;
  try {
    result = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: pending.origin ?? origin,
      expectedRPID: pending.rpId,
      credential: credentialRecord,
      requireUserVerification: multiUser,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passkey verification failed";
    log.warn("WebAuthn login verification error", {
      operation: "webauthn_auth.handle_login_finish.verify_authentication_response",
      clientKey: ctx.getClientKey(req),
      err: error,
    });
    return ctx.json({ error: message }, 401);
  }

  if (!result.verified) {
    ctx.logAuthEvent(req, "WebAuthn login verification failed");
    return ctx.json({ error: "Passkey verification failed" }, 401);
  }

  const sessionToken = (ctx.randomToken ?? randomSessionToken)();
  const issued = getDb().transaction(() => {
    const currentUser = getUser(getDb(), stored.user_id);
    const currentCredential = getWebauthnCredentialById(stored.credential_id);
    if (!currentUser?.enabled || (multiUser && !currentUser.home_chat_jid)
      || !currentCredential || currentCredential.user_id !== stored.user_id
      || currentCredential.public_key !== stored.public_key || currentCredential.rp_id !== stored.rp_id
      || currentCredential.sign_count !== stored.sign_count) return false;
    updateWebauthnCredentialCounter(stored.credential_id, result.authenticationInfo.newCounter);
    createWebSession(sessionToken, stored.user_id, getTtlSeconds(), "passkey");
    return true;
  }).immediate();
  if (!issued) return ctx.json({ error: "Passkey verification failed" }, 401);

  return okJson({ ok: true }, 200, {
    "Set-Cookie": ctx.buildSessionCookie(sessionToken, req),
  });
}

/** Start a passkey registration ceremony from a valid enrollment token. */
export async function handleWebauthnRegisterStart(req: Request, ctx: WebauthnAuthContext): Promise<Response> {
  if (!ctx.isPasskeyEnabled()) return ctx.json({ error: "Passkeys disabled" }, 404);

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return ctx.json({ error: "Invalid JSON" }, 400);
  }

  const token = (body.token || "").trim();
  if (!token) {
    ctx.logAuthEvent(req, "WebAuthn registration missing enrol token");
    return ctx.json({ error: "Missing enrol token" }, 400);
  }

  const enrollment = getWebauthnEnrollment(token);
  if (!enrollment) {
    ctx.logAuthEvent(req, "WebAuthn registration invalid or expired enrol token");
    return ctx.json({ error: "Invalid or expired enrol token" }, 400);
  }

  const multiUser = ctx.accessMode !== undefined && ctx.accessMode !== "single-user";
  const user = multiUser ? getUser(getDb(), enrollment.user_id) : null;
  if (multiUser && (!user?.enabled || !ctx.authoriseEnrolment?.(req, enrollment.user_id))) {
    return ctx.json({ error: "Enrolment access denied" }, 403);
  }
  const { rpId, origin } = resolveWebauthnRpInfo(req);
  const existing = getWebauthnCredentialsForRpId(enrollment.user_id, rpId);
  const excludeCredentials = existing.map((cred) => ({ id: cred.credential_id }));
  const identity = getIdentityConfig();

  const { generateRegistrationOptions } = await loadWebauthnServer();
  const options = await generateRegistrationOptions({
    rpName: identity.assistantName || "PiClaw",
    rpID: rpId,
    userID: new TextEncoder().encode(enrollment.user_id),
    userName: user?.username || identity.userName || enrollment.user_id,
    userDisplayName: user?.display_name || identity.userName || "User",
    ...(multiUser ? { authenticatorSelection: { residentKey: "required" as const, userVerification: "required" as const } } : {}),
    attestationType: "none",
    excludeCredentials,
  });

  ctx.challenges.trackRegistration(
    token,
    {
      challenge: options.challenge,
      rpId,
      userId: enrollment.user_id,
      origin,
    },
    (ctx.now ?? Date.now)()
  );

  return ctx.json({ token, options });
}

/** Finish passkey registration and persist the verified credential. */
export async function handleWebauthnRegisterFinish(req: Request, ctx: WebauthnAuthContext): Promise<Response> {
  if (!ctx.isPasskeyEnabled()) return ctx.json({ error: "Passkeys disabled" }, 404);

  let body: { token?: string; credential?: RegistrationResponseJSON };
  try {
    body = await req.json();
  } catch {
    return ctx.json({ error: "Invalid JSON" }, 400);
  }

  const token = (body.token || "").trim();
  const credential = body.credential;
  if (!token || !credential) {
    ctx.logAuthEvent(req, "WebAuthn registration missing credential payload");
    return ctx.json({ error: "Missing credential" }, 400);
  }

  const now = (ctx.now ?? Date.now)();
  const pending = ctx.challenges.getRegistration(token, now);
  if (!pending) {
    ctx.logAuthEvent(req, "WebAuthn registration expired or unknown token");
    return ctx.json({ error: "Registration expired" }, 400);
  }

  const enrollment = getWebauthnEnrollment(token);
  if (!enrollment) {
    ctx.logAuthEvent(req, "WebAuthn registration invalid or expired enrol token");
    return ctx.json({ error: "Invalid or expired enrol token" }, 400);
  }
  if (enrollment.user_id !== pending.userId) {
    ctx.logAuthEvent(req, "WebAuthn registration enrollment mismatch");
    return ctx.json({ error: "Enrollment mismatch" }, 400);
  }

  const multiUser = ctx.accessMode !== undefined && ctx.accessMode !== "single-user";
  if (multiUser && (!getUser(getDb(), enrollment.user_id)?.enabled || !ctx.authoriseEnrolment?.(req, enrollment.user_id))) {
    return ctx.json({ error: "Enrolment access denied" }, 403);
  }
  const { verifyRegistrationResponse } = await loadWebauthnServer();
  const { origin } = resolveWebauthnRpInfo(req);
  let result: VerifiedRegistrationResponse;
  try {
    result = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: pending.origin ?? origin,
      expectedRPID: pending.rpId,
      ...(multiUser ? { requireUserVerification: true } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passkey verification failed";
    log.warn("WebAuthn registration verification error", {
      operation: "webauthn_auth.handle_register_finish.verify_registration_response",
      clientKey: ctx.getClientKey(req),
      err: error,
    });
    return ctx.json({ error: message }, 401);
  }

  if (!result.verified || !result.registrationInfo) {
    ctx.logAuthEvent(req, "WebAuthn registration verification failed");
    return ctx.json({ error: "Passkey verification failed" }, 401);
  }

  const info = result.registrationInfo;
  if (multiUser && (!getUser(getDb(), enrollment.user_id)?.enabled || !ctx.authoriseEnrolment?.(req, enrollment.user_id))) {
    return ctx.json({ error: "Enrolment access denied" }, 403);
  }
  if (getWebauthnCredentialById(info.credential.id)) return ctx.json({ error: "Credential already registered" }, 409);
  const consumedPending = ctx.challenges.consumeRegistration(token, now);
  if (!consumedPending) {
    ctx.logAuthEvent(req, "WebAuthn registration expired or unknown token");
    return ctx.json({ error: "Registration expired" }, 400);
  }
  const registered = getDb().transaction(() => {
    const consumedEnrollment = consumeWebauthnEnrollment(token);
    if (!consumedEnrollment || consumedEnrollment.user_id !== enrollment.user_id) return false;
    const transports = Array.isArray(credential.response.transports)
      ? JSON.stringify(credential.response.transports)
      : null;
    storeWebauthnCredential({
      user_id: enrollment.user_id,
      rp_id: pending.rpId,
      credential_id: info.credential.id,
      public_key: bufferToBase64Url(info.credential.publicKey),
      sign_count: info.credential.counter || 0,
      transports,
    });
    return true;
  }).immediate();
  if (!registered) return ctx.json({ error: "Invalid or expired enrol token" }, 400);

  return okJson({ ok: true });
}
