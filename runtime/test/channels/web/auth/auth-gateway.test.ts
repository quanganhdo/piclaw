import { describe, expect, test } from "bun:test";
import { WebAuthGateway } from "../../../../src/channels/web/auth/auth-gateway.js";
import type { WebAuthRuntimeConfig } from "../../../../src/channels/web/auth/auth-runtime.js";
import { TotpFailureTracker } from "../../../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../../../src/channels/web/auth/webauthn-challenges.js";

function config(overrides: Partial<WebAuthRuntimeConfig> = {}): WebAuthRuntimeConfig {
  return {
    passkeyMode: "",
    totpSecret: "totp-secret",
    internalSecret: "internal-secret",
    sessionTtlSeconds: 1800,
    hasTls: true,
    ...overrides,
  };
}

describe("web auth gateway", () => {
  test("evaluates auth mode and request authorization helpers", () => {
    const gateway = new WebAuthGateway(config(), {
      principalResolver: { getSession: () => null, getUser: () => null, getLocalDisplayName: () => "User" },
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      challenges: new WebauthnChallengeTracker(),
      failureTracker: new TotpFailureTracker(),
    });

    expect(gateway.isAuthEnabled()).toBe(true);
    expect(gateway.isTotpEnabled()).toBe(true);
    expect(gateway.isPasskeyEnabled()).toBe(true);
    expect(gateway.isPasskeyOnly()).toBe(false);
    expect(gateway.isInternalSecretEnabled()).toBe(true);

    const internalReq = new Request("https://example.com/internal/post", {
      method: "POST",
      headers: { "x-piclaw-internal-secret": "internal-secret" },
    });
    expect(gateway.verifyInternalSecret(internalReq)).toBe(true);

    const authReq = new Request("https://example.com", {
      headers: { cookie: "piclaw_session=session-token" },
    });
    expect(gateway.isAuthenticated(authReq)).toBe(false);
  });

  test("creates auth contexts with cookie/session behavior", () => {
    const gateway = new WebAuthGateway(config({ passkeyMode: "passkey-only", totpSecret: "" }), {
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      challenges: new WebauthnChallengeTracker(),
      failureTracker: new TotpFailureTracker(),
    });

    const totpContext = gateway.createTotpContext();
    const cookie = totpContext.buildSessionCookie("token", new Request("http://example.com"));
    expect(cookie).toContain("piclaw_session=token");
    expect(cookie).toContain("Max-Age=1800");
    expect(cookie).toContain("Secure");

    const webauthnContext = gateway.createWebauthnContext();
    expect(webauthnContext.isPasskeyEnabled()).toBe(true);

    const enrolContext = gateway.createWebauthnEnrolPageContext();
    expect(enrolContext.isPasskeyEnabled()).toBe(true);
  });

  test("routes auth-event logs through injected logger", () => {
    const logs: string[] = [];
    const gateway = new WebAuthGateway(config(), {
      json: (payload, status = 200) => new Response(JSON.stringify(payload), { status }),
      challenges: new WebauthnChallengeTracker(),
      failureTracker: new TotpFailureTracker(),
      logAuthWarning: (message) => logs.push(message),
    });

    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    gateway.createWebauthnContext().logAuthEvent(req, "login failed");

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[auth] login failed");
    expect(logs[0]).toContain("ip=");
  });
});
