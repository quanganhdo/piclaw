import { expect, test } from "bun:test";

import { createMedia, initDatabase } from "../../../src/db.js";
import { handlePdfViewerRoute } from "../../../src/channels/web/http/pdf-viewer-route.js";
import { getTestWorkspace, setEnv } from "../../helpers.js";

function setupPdfMedia(filename = "report.pdf", bytes = "%PDF-1.7\nabcdef\n%%EOF") {
  const ws = getTestWorkspace();
  const restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  initDatabase();
  const mediaId = createMedia(
    filename,
    "application/pdf",
    new TextEncoder().encode(bytes),
    null,
    { size: bytes.length },
  );
  return { mediaId, bytes, restoreEnv };
}

test("pdf viewer page embeds attachment PDFs through the hardened source route", async () => {
  const response = handlePdfViewerRoute(new Request("https://example.com/pdf-viewer/?media=42&name=report.pdf"), "/pdf-viewer");

  expect(response?.status).toBe(200);
  expect(response?.headers.get("Content-Type")).toContain("text/html");
  expect(response?.headers.get("Content-Security-Policy")).toContain("frame-src 'self' blob:");
  const body = await response!.text();
  expect(body).toContain("/pdf-viewer/source?media=");
  expect(body).toContain("application/pdf");
});

test("pdf viewer source serves inline PDFs with filename and byte-range support", async () => {
  const { mediaId, bytes, restoreEnv } = setupPdfMedia("résumé.pdf", "%PDF-1.7\n0123456789\n%%EOF");
  try {
    const response = handlePdfViewerRoute(new Request(
      `https://example.com/pdf-viewer/source?media=${mediaId}`,
      { headers: { range: "bytes=5-9" } },
    ), "/pdf-viewer/source");

    expect(response?.status).toBe(206);
    expect(response?.headers.get("Content-Type")).toBe("application/pdf");
    expect(response?.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response?.headers.get("Content-Disposition")).toBe(`inline; filename="r_sum_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`);
    expect(response?.headers.get("Content-Range")).toBe(`bytes 5-9/${bytes.length}`);
    expect(response?.headers.get("Content-Length")).toBe("5");
    expect(await response!.text()).toBe("1.7\n0");

    const openEnded = handlePdfViewerRoute(new Request(
      `https://example.com/pdf-viewer/source?media=${mediaId}`,
      { headers: { range: "bytes=5-" } },
    ), "/pdf-viewer/source");
    expect(openEnded?.status).toBe(206);
    expect(openEnded?.headers.get("Content-Range")).toBe(`bytes 5-${bytes.length - 1}/${bytes.length}`);

    const suffix = handlePdfViewerRoute(new Request(
      `https://example.com/pdf-viewer/source?media=${mediaId}`,
      { headers: { range: "bytes=-5" } },
    ), "/pdf-viewer/source");
    expect(suffix?.status).toBe(206);
    expect(suffix?.headers.get("Content-Range")).toBe(`bytes ${bytes.length - 5}-${bytes.length - 1}/${bytes.length}`);
    expect(await suffix!.text()).toBe("%%EOF");
  } finally {
    restoreEnv();
  }
});

test("pdf viewer source rejects non-PDF media instead of embedding attachment downloads", () => {
  const ws = getTestWorkspace();
  const restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  try {
    initDatabase();
    const mediaId = createMedia("note.txt", "text/plain", new TextEncoder().encode("hello"), null, { size: 5 });
    const response = handlePdfViewerRoute(new Request(`https://example.com/pdf-viewer/source?media=${mediaId}`), "/pdf-viewer/source");

    expect(response?.status).toBe(415);
  } finally {
    restoreEnv();
  }
});
