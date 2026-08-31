import { fetchQmdDocument, QmdDocumentError } from "./qmd-document-service.js";
import { registerExtensionRoute } from "./extension-routes.js";
import { parseQmdReference, QmdReferenceError, type ParsedQmdReference } from "./qmd-reference.js";

const ROUTE_PREFIX = "/qmd-viewer";
const VIEWER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

export interface QmdViewerRouteDependencies {
  fetchDocument?: (reference: ParsedQmdReference, signal?: AbortSignal) => Promise<string>;
}

export function generateQmdViewerPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QMD Document</title>
<style>
  :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; margin: 0; background: Canvas; color: CanvasText; }
  body { display: flex; flex-direction: column; }
  header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); background: color-mix(in srgb, Canvas 92%, transparent); backdrop-filter: blur(8px); }
  #title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 650; }
  #source { max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: color-mix(in srgb, CanvasText 62%, transparent); font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
  main { width: min(920px, 100%); margin: 0 auto; padding: 28px clamp(18px, 5vw, 58px) 80px; line-height: 1.62; }
  #status { color: color-mix(in srgb, CanvasText 66%, transparent); padding: 28px 0; }
  #content { min-width: 0; overflow-wrap: anywhere; }
  #content h1, #content h2, #content h3 { line-height: 1.25; margin: 1.55em 0 .55em; }
  #content h1:first-child { margin-top: 0; }
  #content p, #content ul, #content ol, #content blockquote, #content pre, #content table { margin: .8em 0; }
  #content pre { overflow: auto; padding: 14px; border-radius: 8px; background: color-mix(in srgb, CanvasText 8%, Canvas); }
  #content code { font: .92em/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  #content :not(pre) > code { padding: .12em .35em; border-radius: 4px; background: color-mix(in srgb, CanvasText 8%, Canvas); }
  #content blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid color-mix(in srgb, CanvasText 25%, transparent); color: color-mix(in srgb, CanvasText 78%, transparent); }
  #content table { display: block; max-width: 100%; overflow: auto; border-collapse: collapse; }
  #content th, #content td { padding: 6px 10px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); text-align: left; }
  #content img { max-width: 100%; height: auto; }
  #content a { color: LinkText; }
  .error { color: #dc2626; white-space: pre-wrap; }
</style>
<script src="/static/common/js/marked.min.js"></script>
</head>
<body>
<header><div id="title">QMD Document</div><div id="source"></div></header>
<main><div id="status">Loading…</div><article id="content" hidden></article></main>
<script>
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var ref = params.get('ref') || '';
  var status = document.getElementById('status');
  var content = document.getElementById('content');
  var title = document.getElementById('title');
  var source = document.getElementById('source');
  var safeTags = new Set(['A','ABBR','BLOCKQUOTE','BR','CODE','DEL','DIV','EM','H1','H2','H3','H4','H5','H6','HR','IMG','KBD','LI','MARK','OL','P','PRE','S','SMALL','SPAN','STRONG','SUB','SUP','TABLE','TBODY','TD','TH','THEAD','TR','U','UL']);

  function safeHref(value) {
    try {
      var parsed = new URL(String(value || ''), location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' || parsed.protocol === 'qmd:') return parsed.href;
    } catch (_) {}
    return null;
  }

  function sanitize(html) {
    var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    var nodes = Array.from(doc.body.querySelectorAll('*'));
    nodes.forEach(function (el) {
      if (!safeTags.has(el.tagName)) {
        el.replaceWith.apply(el, Array.from(el.childNodes));
        return;
      }
      Array.from(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        if (name === 'class' && (el.tagName === 'CODE' || el.tagName === 'SPAN')) return;
        if (name === 'title' || name.indexOf('aria-') === 0) return;
        if (el.tagName === 'A' && name === 'href') {
          var href = safeHref(attr.value);
          if (href) {
            el.setAttribute('href', href);
            if (/^https?:/i.test(href)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
          } else el.removeAttribute(attr.name);
          return;
        }
        if (el.tagName === 'IMG' && name === 'src') {
          var src = safeHref(attr.value);
          if (src && !/^qmd:/i.test(src)) el.setAttribute('src', src); else el.removeAttribute(attr.name);
          return;
        }
        if (el.tagName === 'IMG' && name === 'alt') return;
        el.removeAttribute(attr.name);
      });
    });
    return doc.body.innerHTML;
  }

  function fail(message) {
    status.hidden = false;
    status.className = 'error';
    status.textContent = message || 'Unable to load QMD document.';
    content.hidden = true;
  }

  if (!ref) { fail('Missing QMD reference.'); return; }
  fetch('/qmd-viewer/document?ref=' + encodeURIComponent(ref), { headers: { 'Accept': 'application/json' } })
    .then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status));
        return body;
      });
    })
    .then(function (body) {
      title.textContent = body.title || 'QMD Document';
      source.textContent = body.source || ref;
      document.title = title.textContent + ' · QMD';
      var rendered = window.marked ? window.marked.parse(String(body.markdown || ''), { gfm: true, breaks: true }) : '<pre>' + String(body.markdown || '').replace(/[&<>]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]; }) + '</pre>';
      content.innerHTML = sanitize(rendered);
      status.hidden = true;
      content.hidden = false;
    })
    .catch(function (error) { fail(error && error.message); });

  content.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    if (!/^qmd:/i.test(href)) return;
    event.preventDefault();
    location.href = '/qmd-viewer/?ref=' + encodeURIComponent(href);
  });
})();
</script>
</body>
</html>`;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleQmdViewerRoute(
  req: Request,
  pathname: string,
  dependencies: QmdViewerRouteDependencies = {},
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  if (pathname === `${ROUTE_PREFIX}/document`) {
    const rawReference = new URL(req.url).searchParams.get("ref") ?? "";
    let reference: ParsedQmdReference;
    try {
      reference = parseQmdReference(rawReference);
    } catch (error) {
      const message = error instanceof QmdReferenceError ? error.message : "Invalid QMD reference.";
      return json({ error: message }, 400);
    }
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });

    try {
      const markdown = await (dependencies.fetchDocument ?? fetchQmdDocument)(reference, req.signal);
      return json({
        title: reference.title,
        source: reference.uri,
        markdown,
        fromLine: reference.fromLine ?? null,
        maxLines: reference.maxLines ?? null,
      });
    } catch (error) {
      if (error instanceof QmdDocumentError) return json({ error: error.message }, error.status);
      return json({ error: "QMD document retrieval failed." }, 502);
    }
  }

  if (pathname !== ROUTE_PREFIX && pathname !== `${ROUTE_PREFIX}/`) return new Response("Not Found", { status: 404 });
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": VIEWER_CSP,
  };
  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(generateQmdViewerPage(), { status: 200, headers });
}

registerExtensionRoute(ROUTE_PREFIX, handleQmdViewerRoute, import.meta.dir);
