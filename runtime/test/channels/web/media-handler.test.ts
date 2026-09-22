import { expect, test } from "bun:test";

import { initDatabase, createMedia } from "../../../src/db.js";
import { handleMedia } from "../../../src/channels/web/handlers/media.js";
import { getTestWorkspace, setEnv } from "../../helpers.js";

class StubChannel {
  json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

test("handleMedia serves audio inline for native browser playback", () => {
  const ws = getTestWorkspace();
  const restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  try {
    initDatabase();
    const mediaId = createMedia(
      "recording.wav",
      "audio/wav",
      new TextEncoder().encode("RIFFtestWAVE"),
      null,
      { size: 12 },
    );

    const res = handleMedia(new StubChannel() as any, mediaId, false);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(res.headers.get("Content-Length")).toBe("12");
  } finally {
    restoreEnv();
  }
});

test("handleMedia forces SVG downloads to attachment disposition", () => {
  const ws = getTestWorkspace();
  const restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  try {
    initDatabase();
    const mediaId = createMedia(
      "vector.svg",
      "image/svg+xml",
      new TextEncoder().encode("<svg></svg>"),
      null,
      { size: 11 },
    );

    const res = handleMedia(new StubChannel() as any, mediaId, false);
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="vector.svg"; filename*=UTF-8''vector.svg`);
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Content-Length")).toBe("11");
  } finally {
    restoreEnv();
  }
});


test("single byte ranges and HEAD have bounded exact responses", async () => {
  initDatabase();
  const channel = new StubChannel();
  const id = createMedia("voice.wav", "audio/wav", new TextEncoder().encode("0123456789"), null, null);
  const request = (range?: string, method = "GET") => handleMedia(channel, id, false, new Request("https://test/media/" + id, { method, headers: range ? { Range: range } : {} }));
  const full = request();
  expect(full.status).toBe(200); expect(full.headers.get("accept-ranges")).toBe("bytes");
  expect(await full.text()).toBe("0123456789");
  for (const [range, body, header] of [
    ["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=4-", "456789", "bytes 4-9/10"],
    ["bytes=-4", "6789", "bytes 6-9/10"], ["bytes=8-99", "89", "bytes 8-9/10"],
    ["bytes=-99", "0123456789", "bytes 0-9/10"],
  ]) {
    const result = request(range);
    expect(result.status).toBe(206); expect(result.headers.get("content-range")).toBe(header);
    expect(result.headers.get("content-length")).toBe(String(body.length));
    expect(result.headers.get("content-type")).toBe("audio/wav"); expect(result.headers.get("content-disposition")).toBeNull();
    expect(await result.text()).toBe(body);
  }
  for (const range of ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=9007199254740992-"]) {
    const result = request(range); expect(result.status).toBe(416);
    expect(result.headers.get("content-range")).toBe("bytes */10");
    expect(result.headers.get("content-length")).toBe("0"); expect(await result.text()).toBe("");
  }
  for (const range of ["bytes=abc", "bytes=", "bytes=0-1,4-5", "items=0-1"]) {
    const result = request(range); expect(result.status).toBe(200); expect(await result.text()).toBe("0123456789");
  }
  const head = request("bytes=2-5", "HEAD"); expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe("10"); expect(head.headers.get("content-range")).toBeNull(); expect(await head.text()).toBe("");
  const empty = createMedia("empty.wav", "audio/wav", new Uint8Array(), null, null);
  const emptyRange = handleMedia(channel, empty, false, new Request("https://test/media/" + empty, { headers: { Range: "bytes=0-" } }));
  expect(emptyRange.status).toBe(416); expect(emptyRange.headers.get("content-range")).toBe("bytes */0"); expect(await emptyRange.text()).toBe("");
});

test("audio allowlist never promotes explicit unsafe or unknown MIME by filename", async () => {
  initDatabase();
  const channel = new StubChannel();
  for (const type of ["text/html", "image/svg+xml", "application/xhtml+xml", "audio/x-html", "audio/", "audio/mpegjunk"]) {
    const id = createMedia("looks-like-audio.wav", type, new TextEncoder().encode("<html>bad</html>"), null, null);
    for (const method of ["GET", "HEAD"]) {
      const response = handleMedia(channel, id, false, new Request("https://test/media/" + id, { method, headers: { Range: "bytes=0-3" } }));
      expect(response.status).toBe(method === "HEAD" ? 200 : 206);
      expect(response.headers.get("content-disposition")).toContain("attachment");
      expect(response.headers.get("content-type")).toBe(type);
    }
  }
});


test("legacy malformed MIME values cannot inject or invalidate response headers", async () => {
  initDatabase();
  for (const type of ["audio/wav\r\nX-Injected: bad", "audio/wav\0", "audio/wav\n", "audio/\u0100"]) {
    const id = createMedia("legacy.wav", type, new TextEncoder().encode("bytes"), null, null);
    for (const method of ["GET", "HEAD"]) {
      const result = handleMedia(new StubChannel(), id, false, new Request("https://test/media/" + id, { method, headers: { Range: "bytes=0-1" } }));
      expect(result.status).toBe(method === "GET" ? 206 : 200);
      expect(result.headers.get("content-type")).toBe("application/octet-stream");
      expect(result.headers.get("content-disposition")).toContain("attachment");
      expect(result.headers.get("x-injected")).toBeNull();
    }
  }
});
