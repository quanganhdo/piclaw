import { describe, expect, test } from "bun:test";
import {
  handleAuthVerifyEndpoint,
  handleWebauthnEnrollPageEndpoint,
  handleWebauthnLoginFinishEndpoint,
  handleWebauthnLoginStartEndpoint,
  handleWebauthnRegisterFinishEndpoint,
  handleWebauthnRegisterStartEndpoint,
  redirectToLoginResponse,
  serveLoginPageResponse,
  type AuthEndpointsContext,
} from "../../../../src/channels/web/auth/auth-endpoints.js";
import { TotpFailureTracker } from "../../../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../../../src/channels/web/auth/webauthn-challenges.js";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function context(overrides: Partial<AuthEndpointsContext> = {}): AuthEndpointsContext {
  return {
    createTotpContext: () => ({
      isAuthEnabled: () => true,
      isTotpEnabled: () => true,
      json,
      getClientKey: () => "test-client",
      logAuthEvent: () => {},
      buildSessionCookie: () => "piclaw_session=test",
      failureTracker: new TotpFailureTracker(),
    }),
    createWebauthnContext: () => ({
      isPasskeyEnabled: () => false,
      json,
      buildSessionCookie: () => "piclaw_session=test",
      logAuthEvent: () => {},
      getClientKey: () => "test-client",
      challenges: new WebauthnChallengeTracker(),
    }),
    createWebauthnEnrolPageContext: () => ({
      isPasskeyEnabled: () => false,
      json,
    }),
    serveStatic: async (relPath: string) => new Response(`served:${relPath}`, { status: 200 }),
    ...overrides,
  };
}

describe("web auth endpoints", () => {
  test("delegates auth verify endpoint", async () => {
    const res = await handleAuthVerifyEndpoint(
      new Request("https://example.com/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      context()
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing code" });
  });

  test("delegates webauthn endpoints", async () => {
    const ctx = context();

    const loginStart = await handleWebauthnLoginStartEndpoint(new Request("https://example.com"), ctx);
    const loginFinish = await handleWebauthnLoginFinishEndpoint(new Request("https://example.com"), ctx);
    const registerStart = await handleWebauthnRegisterStartEndpoint(new Request("https://example.com"), ctx);
    const registerFinish = await handleWebauthnRegisterFinishEndpoint(new Request("https://example.com"), ctx);
    const enrolPage = await handleWebauthnEnrollPageEndpoint(ctx);

    expect(loginStart.status).toBe(404);
    expect(loginFinish.status).toBe(404);
    expect(registerStart.status).toBe(410);
    expect(registerFinish.status).toBe(410);
    expect(enrolPage.status).toBe(404);
  });

  test("delegates login page/static serving and redirect response", async () => {
    const served = await serveLoginPageResponse(context());
    expect(await served.text()).toBe("served:login.html");

    const redirect = redirectToLoginResponse();
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe("/login");
  });
});
