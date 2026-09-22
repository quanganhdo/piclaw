import { describe, expect, test } from "bun:test";
import { handleMediaRoutes } from "../../../src/channels/web/http/dispatch-media.js";

describe("web http media dispatch", () => {
  test("returns null for non-media routes", async () => {
    const channel = {} as any;
    const req = new Request("https://example.com/unknown", { method: "GET" });
    const response = await handleMediaRoutes(channel, req, "/unknown");
    expect(response).toBeNull();
  });

  test("dispatches upload route", async () => {
    const channel = {
      handleMediaUpload: async () => new Response("upload", { status: 201 }),
    } as any;

    const req = new Request("https://example.com/media/upload", { method: "POST" });
    const response = await handleMediaRoutes(channel, req, "/media/upload");
    expect(response?.status).toBe(201);
  });

  test("returns 404 for invalid media id", async () => {
    const channel = {
      parseOptionalInt: () => null,
      json: (_payload: unknown, status: number) => new Response("err", { status }),
    } as any;

    const req = new Request("https://example.com/media/bad/thumbnail", { method: "GET" });
    const response = await handleMediaRoutes(channel, req, "/media/bad/thumbnail");
    expect(response?.status).toBe(404);
  });

  test("dispatches thumbnail/info/raw routes", async () => {
    const channel = {
      parseOptionalInt: () => 123,
      json: (_payload: unknown, status: number) => new Response("err", { status }),
      handleMedia: (id: number, thumbnail: boolean) => new Response(`${id}:${thumbnail ? "thumb" : "raw"}`),
      handleMediaInfo: (id: number) => new Response(`${id}:info`),
    } as any;

    const thumbReq = new Request("https://example.com/media/123/thumbnail", { method: "GET" });
    const thumbResponse = await handleMediaRoutes(channel, thumbReq, "/media/123/thumbnail");
    expect(await thumbResponse?.text()).toBe("123:thumb");

    const infoReq = new Request("https://example.com/media/123/info", { method: "GET" });
    const infoResponse = await handleMediaRoutes(channel, infoReq, "/media/123/info");
    expect(await infoResponse?.text()).toBe("123:info");

    const rawReq = new Request("https://example.com/media/123", { method: "GET" });
    const rawResponse = await handleMediaRoutes(channel, rawReq, "/media/123");
    expect(await rawResponse?.text()).toBe("123:raw");
  });
});


test("raw and thumbnail dispatch forward the request for Range and HEAD", async () => {
  for (const method of ["GET", "HEAD"]) {
    for (const suffix of ["", "/thumbnail"]) {
      const request = new Request("https://test/media/42" + suffix, { method, headers: { Range: "bytes=2-5" } });
      const channel = { parseOptionalInt: () => 42, handleMedia: (id: number, thumbnail: boolean, req: Request) => {
        expect(id).toBe(42); expect(thumbnail).toBe(Boolean(suffix)); expect(req).toBe(request);
        return new Response(null, { status: 200 });
      } } as any;
      expect((await handleMediaRoutes(channel, request, new URL(request.url).pathname))?.status).toBe(200);
    }
  }
});


test("single-user router preserves normal auth before media Range and HEAD", async () => {
  const { RequestRouterService } = await import("../../../src/channels/web/request-router-service.js");
  const { WebAuthGateway } = await import("../../../src/channels/web/auth/auth-gateway.js");
  const { WebauthnChallengeTracker } = await import("../../../src/channels/web/auth/webauthn-challenges.js");
  const { TotpFailureTracker } = await import("../../../src/channels/web/auth/totp-failure-tracker.js");
  const { initDatabase, createMedia } = await import("../../../src/db.js");
  const parseOptionalInt = (value: string) => /^\d+$/.test(value) ? Number(value) : null;
  initDatabase();
  const id = createMedia("voice.wav", "audio/wav", new TextEncoder().encode("0123456789"), null, null);
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const gateway = new WebAuthGateway({ passkeyMode: "", totpSecret: "", internalSecret: "fixture-secret", hasTls: false, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway: gateway, parseOptionalInt, rememberWebOrigin: () => {} } as any);
  for (const method of ["GET", "HEAD"]) {
    const response = await router.handle(new Request(`http://localhost/media/${id}`, { method, headers: { Range: "bytes=2-5" } }));
    expect(response.status).toBe(method === "HEAD" ? 200 : 206);
    expect(await response.text()).toBe(method === "HEAD" ? "" : "2345");
  }
});
