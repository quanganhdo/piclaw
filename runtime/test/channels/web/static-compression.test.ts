import { expect, test } from "bun:test";
import { gunzipSync } from "bun";

import { serveStatic } from "../../../src/channels/web/http/static.js";
import { getRouteFlags, isPublicWidgetAssetPath, shouldSkipAuthCheck } from "../../../src/channels/web/http/route-flags.js";

for (const asset of ['common/js/vendor/three/three.module.min.js', 'common/js/vendor/three/three.core.min.js', 'common/js/vendor/remote-display-decoder.wasm', 'common/js/vendor/xterm/xterm.css', 'common/fonts/KaTeX_Main-Regular.woff2']) {
  test(`opaque widget dependency is public and credential-free CORS: ${asset}`, async () => {
    for (const encoding of ['', 'gzip', 'br, gzip']) {
      const req = new Request(`https://example.test/static/${asset}`, {headers: {Origin:'null', 'Accept-Encoding':encoding}});
      expect(shouldSkipAuthCheck(getRouteFlags(req, new URL(req.url).pathname), false)).toBe(true);
      const response = await serveStatic(asset, notFound, req);
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    }
  });
}

test('widget CORS never exposes authenticated bundles, API data, metadata or traversal', async () => {
  for (const path of ['/static/classic/dist/app.bundle.js', '/static/common/dist/family.bundle.js', '/agent/keychain', '/workspace/secret.js', '/static/common/js/vendor/three/three.meta.json', '/static/common/js/vendor/../../../classic/dist/app.bundle.js', '/static/common/js/vendor/%2e%2e/secret.js']) {
    expect(isPublicWidgetAssetPath(path)).toBe(false);
    expect(shouldSkipAuthCheck(getRouteFlags(new Request('https://example.test'), path), false)).toBe(false);
  }
  const response = await serveStatic('classic/dist/app.bundle.css', notFound);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
});

function notFound(): Response {
  return new Response("not found", { status: 404 });
}

test("serveStatic gzip-compresses compressible assets when requested", async () => {
  const req = new Request("https://example.test/static/classic/dist/app.bundle.css", {
    headers: { "Accept-Encoding": "gzip" },
  });

  const response = await serveStatic("classic/dist/app.bundle.css", notFound, req);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBe("gzip");
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
  expect(response.headers.get("Content-Type")).toContain("text/css");

  const compressed = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(gunzipSync(Buffer.from(compressed)));
  expect(text).toContain(":root");
});

test("serveStatic falls back to runtime gzip when brotli is accepted but no sidecar exists", async () => {
  const req = new Request("https://example.test/static/classic/dist/app.bundle.css", {
    headers: { "Accept-Encoding": "br, gzip" },
  });

  const response = await serveStatic("classic/dist/app.bundle.css", notFound, req);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBe("gzip");
});

test("serveStatic serves vendored ESM modules with a JavaScript MIME type", async () => {
  const response = await serveStatic("common/js/vendor/xterm/xterm.mjs", notFound);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBeNull();
  expect(response.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
});

test("serveStatic gzip-compresses wasm assets when requested", async () => {
  const req = new Request("https://example.test/static/common/js/vendor/remote-display-decoder.wasm", {
    headers: { "Accept-Encoding": "gzip" },
  });

  const response = await serveStatic("common/js/vendor/remote-display-decoder.wasm", notFound, req);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBe("gzip");
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
  expect(response.headers.get("Content-Type")).toBe("application/wasm");

  const compressed = new Uint8Array(await response.arrayBuffer());
  const wasm = new Uint8Array(gunzipSync(Buffer.from(compressed)));
  expect(Array.from(wasm.slice(0, 4))).toEqual([0x00, 0x61, 0x73, 0x6d]);
});

test("serveStatic leaves already-compressed assets unencoded", async () => {
  const req = new Request("https://example.test/static/favicon.ico", {
    headers: { "Accept-Encoding": "gzip" },
  });

  const response = await serveStatic("favicon.ico", notFound, req);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBeNull();
  expect(response.headers.get("Vary")).toBeNull();
});

test("serveStatic adds Vary for compressible assets even without compression", async () => {
  const response = await serveStatic("classic/dist/app.bundle.css", notFound);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBeNull();
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
});
