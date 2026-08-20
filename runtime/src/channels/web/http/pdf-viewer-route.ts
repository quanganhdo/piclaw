/**
 * pdf-viewer-route.ts — Lightweight authenticated PDF viewer route.
 *
 * Serves:
 *   - /pdf-viewer            -> same-origin HTML PDF wrapper
 *   - /pdf-viewer/?path=...  -> workspace file preview
 *   - /pdf-viewer/?media=... -> media attachment preview
 *   - /pdf-viewer/source?... -> inline PDF stream for attachment previews
 */

import { buildContentDisposition } from "./content-disposition.js";
import { registerExtensionRoute } from "./extension-routes.js";
import { MediaService } from "../media/media-service.js";

const ROUTE_PREFIX = "/pdf-viewer";
const mediaService = new MediaService();

const VIEWER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function generatePdfViewerPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF Viewer</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: #1e1e1e;
    color: #e0e0e0;
    font-family: system-ui, -apple-system, sans-serif;
  }
  object {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
    background: #1e1e1e;
  }
  .empty {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    color: #888;
    font: 14px system-ui, -apple-system, sans-serif;
    padding: 24px;
    text-align: center;
  }
  .fallback {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .fallback-card {
    max-width: 420px;
    text-align: center;
  }
  .fallback-card a {
    color: #7dc3ff;
  }
</style>
</head>
<body>
<script>
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var hashParams = new URLSearchParams((location.hash || '').replace(/^#/, ''));

  function getFlexibleParam(name) {
    var direct = params.get(name);
    if (direct) return direct;
    for (var it = params.entries(), next = it.next(); !next.done; next = it.next()) {
      var key = String(next.value[0] || '');
      var normalized = key.replace(/^amp;/i, '');
      if (normalized === name) return String(next.value[1] || '');
    }
    return '';
  }

  function firstNonEmpty(parts) {
    for (var i = 0; i < parts.length; i++) {
      if (parts[i]) return parts[i];
    }
    return '';
  }

  var path = firstNonEmpty([
    getFlexibleParam('path'),
    hashParams.get('path') || '',
  ]);

  var media = firstNonEmpty([
    getFlexibleParam('media'),
    hashParams.get('media') || '',
  ]);

  var explicitName = firstNonEmpty([
    getFlexibleParam('name'),
    hashParams.get('name') || '',
  ]);

  var sourceUrl = '';
  if (path) {
    sourceUrl = '/workspace/raw?path=' + encodeURIComponent(path);
  } else if (/^\\d+$/.test(media) && Number(media) > 0) {
    sourceUrl = '/pdf-viewer/source?media=' + encodeURIComponent(media);
  }

  if (!sourceUrl) {
    document.body.innerHTML = '<div class="empty">Missing <code>?path=...</code> or <code>?media=...</code> query parameter.</div>';
    return;
  }

  var inferredName = path ? (path.split('/').pop() || 'document.pdf') : ('attachment-' + media + '.pdf');
  var name = explicitName || inferredName;

  var objectEl = document.createElement('object');
  objectEl.data = sourceUrl;
  objectEl.type = 'application/pdf';
  objectEl.setAttribute('aria-label', name);
  objectEl.innerHTML = '<div class="fallback"><div class="fallback-card"><p>PDF preview is unavailable in this browser context.</p><p><a href="' + sourceUrl + '" target="_blank" rel="noopener noreferrer">Open PDF in a new tab</a></p></div></div>';
  document.body.appendChild(objectEl);
})();
</script>
</body>
</html>`;
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function handlePdfMediaSource(req: Request): Response {
  const url = new URL(req.url);
  const mediaId = parsePositiveInt(url.searchParams.get("media"));
  if (!mediaId) {
    return new Response("Missing or invalid media id", { status: 400 });
  }

  const result = mediaService.getMedia(mediaId, false);
  if (result.status !== 200) {
    return new Response("Not Found", { status: 404 });
  }

  const contentType = (result.contentType || "").toLowerCase();
  if (contentType !== "application/pdf") {
    return new Response("Unsupported Media Type", { status: 415 });
  }

  const size = result.body.size;
  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Content-Disposition": buildContentDisposition("inline", result.filename || `attachment-${mediaId}.pdf`),
    "Cache-Control": "no-cache",
    "Accept-Ranges": "bytes",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": VIEWER_CSP,
    ...(size > 0 ? { "Content-Length": String(size) } : {}),
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  const rangeHeader = req.headers.get("range");
  if (rangeHeader && size > 0) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (match && (match[1] || match[2])) {
      const suffixLength = !match[1] && match[2] ? Number(match[2]) : null;
      const start = suffixLength !== null ? Math.max(0, size - suffixLength) : Number(match[1]);
      const requestedEnd = suffixLength !== null || !match[2] ? size - 1 : Number(match[2]);
      const end = Math.min(requestedEnd, size - 1);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start >= size || start > end || suffixLength === 0) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: {
            ...headers,
            "Content-Range": `bytes */${size}`,
            "Content-Length": "0",
          },
        });
      }
      const chunk = result.body.slice(start, end + 1, "application/pdf");
      return new Response(chunk, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
  }

  return new Response(result.body, { status: 200, headers });
}

export function handlePdfViewerRoute(req: Request, pathname: string): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const relative = pathname.replace(/^\/pdf-viewer\/?/, "");

  if (relative === "source") {
    return handlePdfMediaSource(req);
  }

  if (relative && !relative.startsWith("?")) {
    return new Response("Not Found", { status: 404 });
  }

  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": VIEWER_CSP,
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(generatePdfViewerPage(), { status: 200, headers });
}

registerExtensionRoute(ROUTE_PREFIX, handlePdfViewerRoute, import.meta.dir);
