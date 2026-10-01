import { afterEach, describe, expect, test } from "bun:test";

import { getRouteFlags } from "../../../src/channels/web/http/route-flags.js";
import { getDataRateLimitRule } from "../../../src/channels/web/http/rate-limit-rules.js";
import { enforceRequestGuards } from "../../../src/channels/web/http/request-guards.js";
import { resetRateLimiterStateForTests } from "../../../src/channels/web/http/rate-limit.js";
import { buildRouteFlags } from "./helpers/route-flags.js";

afterEach(() => {
  resetRateLimiterStateForTests();
});

function createChannel(overrides: {
  authGateway?: Partial<{
    isAuthEnabled(): boolean;
    isInternalSecretEnabled(): boolean;
    verifyInternalSecret(req: Request): boolean;
    isAuthenticated(req: Request): boolean;
  }>;
} = {}): any {
  return {
    authGateway: {
      isAuthEnabled: () => true,
      isInternalSecretEnabled: () => true,
      verifyInternalSecret: () => false,
      isAuthenticated: () => true,
      ...overrides.authGateway,
    },
    endpointContexts: {
      auth: () => ({}) as any,
    },
    json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status }),
  };
}

describe("request guards", () => {
  test("blocks internal routes without the internal secret", async () => {
    const response = await enforceRequestGuards(
      createChannel(),
      new Request("https://example.com/internal/post", { method: "POST" }),
      "/internal/post",
      buildRouteFlags({ isInternalPost: true, isMutating: true }),
    );

    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "Unauthorized" });
  });

  test("redirects unauthenticated GET requests to login", async () => {
    const response = await enforceRequestGuards(
      createChannel({
        authGateway: {
          isAuthenticated: () => false,
          isInternalSecretEnabled: () => false,
        },
      }),
      new Request("https://example.com/thread/1", { method: "GET" }),
      "/thread/1",
      buildRouteFlags({ isGetOrHead: true }),
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/login");
  });

  test("rejects mutating requests that fail the CSRF origin check", async () => {
    const response = await enforceRequestGuards(
      createChannel({
        authGateway: {
          isInternalSecretEnabled: () => false,
        },
      }),
      new Request("https://example.com/post", {
        method: "POST",
        headers: {
          origin: "https://evil.example.com",
          host: "example.com",
        },
      }),
      "/post",
      buildRouteFlags({ isMutating: true }),
    );

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Origin not allowed" });
  });
});

test('large media upload route is authenticated, CSRF guarded and chunk-rate limited', async () => {
  const path='/media/upload-chunk';const req=new Request('https://example.com'+path,{method:'POST',headers:{origin:'https://example.com',host:'example.com'}});
  const flags=getRouteFlags(req,path);
  expect((await enforceRequestGuards(createChannel({authGateway:{isAuthenticated:()=>false}}),req,path,flags))?.status).toBe(401);
  const hostile=new Request('https://example.com'+path,{method:'POST',headers:{origin:'https://evil.test',host:'example.com'}});
  expect((await enforceRequestGuards(createChannel(),hostile,path,getRouteFlags(hostile,path)))?.status).toBe(403);
  expect(await enforceRequestGuards(createChannel(),req,path,flags)).toBeNull();
  expect(getDataRateLimitRule('POST',path)).toMatchObject({bucket:'data/media_upload_chunk',limit:240});
});
