import { describe, expect, test } from "bun:test";
import { handleManifestRequest } from "../../../src/channels/web/manifest.js";

describe("web manifest helper", () => {
  test("returns manifest JSON for GET and preserves headers", async () => {
    const req = new Request("https://example.com/manifest.json", { method: "GET" });
    const res = await handleManifestRequest(req, {
      assistantName: "Pi",
      assistantAvatar: null,
      ensureAvatarCache: async () => null,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/manifest+json; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.text();
    const manifest = JSON.parse(body);
    expect(manifest.name).toBe("Pi");
    expect(manifest.icons.length).toBe(4);
    expect(Number(res.headers.get("Content-Length"))).toBeGreaterThan(0);
  });

  test("returns headers-only response for HEAD", async () => {
    const req = new Request("https://example.com/manifest.json", { method: "HEAD" });
    const res = await handleManifestRequest(req, {
      assistantName: "Pi",
      assistantAvatar: null,
      ensureAvatarCache: async () => null,
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(res.headers.get("Content-Length")).toBeTruthy();
  });

  test("uses explicit avatar-sized manifest icons when a cached agent avatar is available", async () => {
    const req = new Request("https://example.com/manifest.json", { method: "GET" });
    const res = await handleManifestRequest(req, {
      assistantName: "Pi",
      assistantAvatar: "file:///tmp/avatar.png",
      ensureAvatarCache: async () => ({
        updatedAt: "2026-03-09T00:00:00.000Z",
        contentType: "image/webp",
      }),
    });

    const manifest = await res.json();
    expect(manifest.icons).toEqual([192, 512].flatMap(size => [
      { src: `/avatar/agent?format=png&size=${size}&v=2026-03-09T00%3A00%3A00.000Z`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' },
      { src: `/avatar/agent?format=png&size=${size}&purpose=maskable&v=2026-03-09T00%3A00%3A00.000Z`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' },
    ]));
  });
});
