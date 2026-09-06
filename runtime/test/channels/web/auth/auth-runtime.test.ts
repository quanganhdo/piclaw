import { describe, expect, test } from "bun:test";
import {
  createTotpAuthContext,
  createWebauthnAuthContext,
  createWebauthnEnrolPageContext,
  isAuthEnabled,
  isInternalSecretEnabled,
  isPasskeyEnabled,
  isPasskeyOnly,
  isTotpEnabled,
  verifyInternalSecret,
  type WebAuthRuntimeConfig,
} from "../../../../src/channels/web/auth/auth-runtime.js";
import { WebauthnChallengeTracker } from "../../../../src/channels/web/auth/webauthn-challenges.js";
import { TotpFailureTracker } from "../../../../src/channels/web/auth/totp-failure-tracker.js";

function config(overrides: Partial<WebAuthRuntimeConfig> = {}): WebAuthRuntimeConfig {
  return {
    passkeyMode: "",
    totpSecret: "secret",
    internalSecret: "internal",
    sessionTtlSeconds: 3600,
    hasTls: false,
    ...overrides,
  };
}

describe("web auth runtime helpers", () => {
  test("multi-user configuration never disables request authentication", () => {
    for (const accessMode of ["family-shared", "isolated-containers"] as const) {
      expect(isAuthEnabled(config({ accessMode, totpSecret: "", passkeyMode: "totp-only" }))).toBe(true);
    }
  });
  test("evaluates auth mode flags", () => {
    expect(isTotpEnabled(config())).toBe(true);
    expect(isPasskeyEnabled(config())).toBe(true);
    expect(isAuthEnabled(config())).toBe(true);

    expect(isPasskeyEnabled(config({ passkeyMode: "totp-only" }))).toBe(false);
    expect(isPasskeyEnabled(config({ passkeyMode: "passkey-only", totpSecret: "" }))).toBe(true);
    expect(isPasskeyOnly(config({ passkeyMode: "passkey-only" }))).toBe(true);
    expect(isAuthEnabled(config({ totpSecret: "", passkeyMode: "totp-only" }))).toBe(false);
  });

  test("internal secret helpers require matching secret", () => {
    const req = new Request("https://example.com/internal/post", {
      method: "POST",
      headers: { "x-piclaw-internal-secret": "internal" },
    });

    expect(isInternalSecretEnabled(config())).toBe(true);
    expect(verifyInternalSecret(req, config())).toBe(true);
    expect(verifyInternalSecret(req, config({ internalSecret: "different" }))).toBe(false);
  });

  test("context builders preserve behavior and cookie settings", () => {
    const authConfig = config({ hasTls: true, sessionTtlSeconds: 1200 });

    const totpContext = createTotpAuthContext(authConfig, {
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      getClientKey: () => "key",
      logAuthEvent: () => {},
      failureTracker: new TotpFailureTracker(),
    });

    const cookie = totpContext.buildSessionCookie("token", new Request("http://example.com"));
    expect(cookie).toContain("piclaw_session=token");
    expect(cookie).toContain("Max-Age=1200");
    expect(cookie).toContain("Secure");

    const challenges = new WebauthnChallengeTracker();
    const webauthnContext = createWebauthnAuthContext(authConfig, {
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      getClientKey: () => "key",
      logAuthEvent: () => {},
      challenges,
    });
    expect(webauthnContext.isPasskeyEnabled()).toBe(true);

    const enrolContext = createWebauthnEnrolPageContext(authConfig, {
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
    });
    expect(enrolContext.isPasskeyEnabled()).toBe(true);
  });
});
