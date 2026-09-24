import { describe, expect, test } from "bun:test";
import { handleAuthRoutes } from "../../../src/channels/web/http/dispatch-auth.js";
import { closeDbQuietly, importFresh, withTempWorkspaceEnv } from "../../helpers.js";
import { buildRouteFlags } from "./helpers/route-flags.js";

describe("web http auth dispatch", () => {
  test("returns null when no auth route matches", async () => {
    const channel = {} as any;
    const req = new Request("https://example.com/unknown", { method: "GET" });
    const response = await handleAuthRoutes(channel, req, buildRouteFlags());
    expect(response).toBeNull();
  });

  test("single-user enrol links are retired even without a TOTP session", async () => {
    const channel = {
      authGateway: {
        isTotpSession: () => false,
      },
      endpointContexts: {
        auth: () => ({
          createTotpContext: () => ({}) as any,
          createWebauthnContext: () => ({}) as any,
          createWebauthnEnrolPageContext: () => ({
            isPasskeyEnabled: () => true,
            json: (_payload: unknown, status = 200) => new Response(null, { status }),
          }),
          serveStatic: async () => new Response("ok"),
        }),
      },
      json: (_payload: unknown, status: number) => new Response(null, { status }),
    } as any;

    const getReq = new Request("https://example.com/auth/webauthn/enrol", { method: "GET" });
    const getFlags = buildRouteFlags({ isWebauthnEnrollPage: true, isGetOrHead: true });
    expect((await handleAuthRoutes(channel, getReq, getFlags))?.status).toBe(410);

    const postReq = new Request("https://example.com/auth/webauthn/enrol", { method: "POST" });
    const postFlags = buildRouteFlags({ isWebauthnEnrollPage: true });
    expect((await handleAuthRoutes(channel, postReq, postFlags))?.status).toBe(410);
  });

  test("E2E bootstrap accepts remote requests authorized by the internal secret", async () => {
    await withTempWorkspaceEnv("piclaw-e2e-bootstrap-", {
      PICLAW_INTERNAL_SECRET: "test-secret",
      PICLAW_WEB_INTERNAL_SECRET: undefined,
    }, async () => {
      const db = await importFresh<typeof import("../../../src/db.js")>("../src/db.js");
      const config = await importFresh<typeof import("../../../src/core/config.js")>("../src/core/config.js");
      db.initDatabase();
      const previousSecret = config.WEB_RUNTIME_CONFIG.internalSecret;
      config.WEB_RUNTIME_CONFIG.internalSecret = "test-secret";
      try {
        const auth = await importFresh<typeof import("../../../src/channels/web/http/dispatch-auth.js")>(
          "../src/channels/web/http/dispatch-auth.js",
        );
        const channel = {
          authGateway: { isTotpSession: () => false },
          endpointContexts: { auth: () => ({}) },
          json: (_payload: unknown, status: number) => new Response(null, { status }),
        } as any;
        const req = new Request("https://microvm.example.test/auth/e2e/bootstrap", {
          method: "POST",
          headers: { "x-piclaw-internal-secret": "test-secret" },
        });

        const response = await auth.handleAuthRoutes(channel, req, buildRouteFlags({ isE2eBootstrap: true }));

        expect(response?.status).toBe(200);
        expect(response?.headers.get("set-cookie") || "").toContain("piclaw_session=");
      } finally {
        config.WEB_RUNTIME_CONFIG.internalSecret = previousSecret;
        closeDbQuietly(db);
      }
    });
  });

  test("dispatches webauthn start/finish routes", async () => {
    const channel = {
      authGateway: {
        isTotpSession: () => true,
      },
      endpointContexts: {
        auth: () => ({
          createTotpContext: () => ({}) as any,
          createWebauthnContext: () => ({
            isPasskeyEnabled: () => false,
            json: (_payload: unknown, status = 200) => new Response(null, { status }),
          }),
          createWebauthnEnrolPageContext: () => ({
            isPasskeyEnabled: () => false,
            json: (_payload: unknown, status = 200) => new Response(null, { status }),
          }),
          serveStatic: async () => new Response("unused"),
        }),
      },
      json: (_payload: unknown, status: number) => new Response(null, { status }),
    } as any;

    const req = new Request("https://example.com/auth/webauthn", { method: "POST" });

    expect((await handleAuthRoutes(channel, req, buildRouteFlags({ isWebauthnEnrollPage: true })))?.status).toBe(410);
    expect((await handleAuthRoutes(channel, req, buildRouteFlags({ isWebauthnLoginStart: true })))?.status).toBe(404);
    expect((await handleAuthRoutes(channel, req, buildRouteFlags({ isWebauthnLoginFinish: true })))?.status).toBe(404);
    expect((await handleAuthRoutes(channel, req, buildRouteFlags({ isWebauthnRegisterStart: true })))?.status).toBe(410);
    expect((await handleAuthRoutes(channel, req, buildRouteFlags({ isWebauthnRegisterFinish: true })))?.status).toBe(410);
  });
});
