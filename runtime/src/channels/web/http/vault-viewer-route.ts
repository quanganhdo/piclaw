import { fetchVaultAsset, fetchVaultDocument, VaultDocumentError, type VaultAsset } from "./vault-document-service.js";
import { registerExtensionRoute } from "./extension-routes.js";
import { parseVaultReference, VaultReferenceError, type ParsedVaultReference } from "./vault-reference.js";

const ROUTE_PREFIX = "/vault-viewer";
const ASSET_TIMEOUT_MS = 5_000;
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

export interface VaultViewerRouteDependencies {
  fetchDocument?: (reference: ParsedVaultReference, signal?: AbortSignal) => Promise<string>;
  fetchAsset?: (reference: ParsedVaultReference, path: string, signal?: AbortSignal) => Promise<VaultAsset>;
}

export function generateVaultViewerPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Learning note</title>
<style>
  :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; margin: 0; background: Canvas; color: CanvasText; }
  body { display: flex; flex-direction: column; }
  header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); background: color-mix(in srgb, Canvas 92%, transparent); backdrop-filter: blur(8px); }
  #navigation { display: flex; flex: 0 0 auto; gap: 4px; }
  #navigation button { width: 32px; height: 32px; padding: 0; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 7px; background: color-mix(in srgb, CanvasText 5%, Canvas); color: CanvasText; font: 18px/1 system-ui, sans-serif; cursor: pointer; }
  #navigation button:hover:not(:disabled) { background: color-mix(in srgb, CanvasText 11%, Canvas); }
  #navigation button:focus-visible { outline: 2px solid LinkText; outline-offset: 1px; }
  #navigation button:disabled { cursor: default; opacity: .35; }
  #title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 650; }
  #source { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: color-mix(in srgb, CanvasText 62%, transparent); font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
  @media (max-width: 600px) { header { padding: 8px 10px; gap: 8px; } #source { display: none; } }
  main { width: min(920px, 100%); margin: 0 auto; padding: 28px clamp(18px, 5vw, 58px) 80px; line-height: 1.62; }
  #status { color: color-mix(in srgb, CanvasText 66%, transparent); padding: 28px 0; }
  #content { min-width: 0; overflow-wrap: anywhere; }
  #content h1, #content h2, #content h3 { line-height: 1.25; margin: 1.55em 0 .55em; scroll-margin-top: 58px; }
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
<header><nav id="navigation" aria-label="Note history"><button id="back" type="button" aria-label="Back" title="Back (Alt+Left)" disabled>←</button><button id="forward" type="button" aria-label="Forward" title="Forward (Alt+Right)" disabled>→</button></nav><div id="title" aria-live="polite">Learning note</div><div id="source"></div></header>
<main><div id="status">Loading…</div><article id="content" hidden></article></main>
<script>
(function () {
  'use strict';
  var vaultPrefix = 'obsidian:////workspace/vaults/learning/';
  var vaultPathPrefix = '//workspace/vaults/learning/';
  var params = new URLSearchParams(location.search);
  var ref = params.get('ref') || '';
  var status = document.getElementById('status');
  var content = document.getElementById('content');
  var title = document.getElementById('title');
  var source = document.getElementById('source');
  var backButton = document.getElementById('back');
  var forwardButton = document.getElementById('forward');
  var maxNavigationEntries = 100;
  var navigationEntries = ref ? [{ ref: ref, scrollY: null, title: '' }] : [];
  var navigationIndex = navigationEntries.length ? 0 : -1;
  var navigationRequest = 0;
  var navigationController = null;
  var safeTags = new Set(['A','ABBR','BLOCKQUOTE','BR','CODE','DEL','DIV','EM','H1','H2','H3','H4','H5','H6','HR','IMG','KBD','LI','MARK','OL','P','PRE','S','SMALL','SPAN','STRONG','SUB','SUP','TABLE','TBODY','TD','TH','THEAD','TR','U','UL']);

  function vaultParts(value) {
    try {
      var parsed = new URL(String(value || ''));
      if (parsed.protocol !== 'obsidian:' || parsed.host || parsed.search || !parsed.pathname.startsWith(vaultPathPrefix)) return null;
      var encodedPath = parsed.pathname.slice(vaultPathPrefix.length);
      if (/%(?:2f|5c)/i.test(encodedPath)) return null;
      var path = decodeURIComponent(encodedPath);
      if (!path || path.indexOf('\\\\') >= 0) return null;
      var segments = path.split('/');
      if (segments.some(function (part) { return !part || part === '.' || part === '..'; })) return null;
      if (!/\\.md$/i.test(path)) path += '.md';
      return { path: path, heading: parsed.hash ? decodeURIComponent(parsed.hash.slice(1)) : '' };
    } catch (_) { return null; }
  }

  function normalizeSegments(segments) {
    var result = [];
    for (var i = 0; i < segments.length; i += 1) {
      var part = segments[i];
      if (!part || part === '.') continue;
      if (part === '..') { if (!result.length) return null; result.pop(); }
      else result.push(part);
    }
    return result;
  }

  function encodePath(path) {
    return path.split('/').map(function (part) { return encodeURIComponent(part); }).join('/');
  }

  function noteHref(target, documentRef, wikiRooted) {
    var raw = String(target || '').trim();
    if (!raw) return null;
    if (/^obsidian:/i.test(raw)) return vaultParts(raw) ? raw : null;
    var hashAt = raw.indexOf('#');
    var pathPart = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
    var heading = hashAt >= 0 ? raw.slice(hashAt + 1) : '';
    var sourceParts = vaultParts(documentRef);
    if (!sourceParts || /^[\\/]/.test(pathPart) || pathPart.indexOf('\\\\') >= 0) return null;
    var sourceDir = sourceParts.path.split('/').slice(0, -1);
    var targetSegments = pathPart ? pathPart.split('/') : [sourceParts.path.split('/').pop()];
    var base = pathPart && wikiRooted && pathPart.indexOf('/') >= 0 ? [] : sourceDir;
    var normalized = normalizeSegments(base.concat(targetSegments));
    if (!normalized || !normalized.length) return null;
    var path = normalized.join('/').replace(/\\.md$/i, '');
    return vaultPrefix + encodePath(path) + (heading ? '#' + encodeURIComponent(heading) : '');
  }

  function relativeAssetPath(target, documentRef, wikiRooted) {
    var raw = String(target || '').trim();
    var sourceParts = vaultParts(documentRef);
    if (!raw || !sourceParts || /^[\\/]/.test(raw) || raw.indexOf('\\\\') >= 0 || raw.indexOf('?') >= 0 || raw.indexOf('#') >= 0) return null;
    var sourceDir = sourceParts.path.split('/').slice(0, -1);
    var targetAbsolute = normalizeSegments((wikiRooted && raw.indexOf('/') >= 0 ? [] : sourceDir).concat(raw.split('/')));
    if (!targetAbsolute) return null;
    var common = 0;
    while (common < sourceDir.length && common < targetAbsolute.length && sourceDir[common] === targetAbsolute[common]) common += 1;
    return sourceDir.slice(common).map(function () { return '..'; }).concat(targetAbsolute.slice(common)).join('/');
  }

  function escapeLabel(value) { return String(value || '').replace(/&/g, '&amp;').replace(/\\[/g, '&#91;').replace(/\\]/g, '&#93;'); }

  function rewriteWikiLinks(markdown, documentRef) {
    return String(markdown || '').replace(/(!?)\\[\\[([^\\]\\n]+)\\]\\]/g, function (_, embed, body) {
      var pieces = body.split('|');
      var target = String(pieces.shift() || '').trim();
      var label = String(pieces.join('|') || target.split('#')[0].split('/').pop() || target).trim();
      if (!target) return escapeLabel(label);
      var extension = (target.split('#')[0].match(/\\.[A-Za-z0-9]+$/) || [])[0] || '';
      if (embed || (extension && !/\\.md$/i.test(extension))) {
        var assetPath = relativeAssetPath(target.split('#')[0], documentRef, true);
        if (!assetPath) return escapeLabel(label);
        return embed ? '![' + escapeLabel(label) + '](<' + assetPath + '>)' : '[' + escapeLabel(label) + '](<' + assetPath + '>)';
      }
      var href = noteHref(target, documentRef, true);
      return href ? '[' + escapeLabel(label) + '](' + href + ')' : escapeLabel(label);
    });
  }

  function safeHref(value, documentRef) {
    var raw = String(value || '').trim();
    if (!raw) return null;
    if (raw.charAt(0) === '#') return raw;
    if (/^obsidian:/i.test(raw)) return vaultParts(raw) ? raw : null;
    if (/^qmd:/i.test(raw)) return raw;
    try {
      if (/^(?:https?:|mailto:)/i.test(raw)) {
        var external = new URL(raw);
        return ['http:', 'https:', 'mailto:'].indexOf(external.protocol) >= 0 ? external.href : null;
      }
    } catch (_) { return null; }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || /^[\\/]/.test(raw) || raw.indexOf('?') >= 0) return null;
    var hashAt = raw.indexOf('#');
    var localPath = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
    if (/\\.md$/i.test(localPath)) return noteHref(raw, documentRef, false);
    if (raw.indexOf('#') >= 0) return null;
    return '/vault-viewer/asset?ref=' + encodeURIComponent(documentRef) + '&path=' + encodeURIComponent(raw);
  }

  function imageHref(value, documentRef) {
    var raw = String(value || '').trim();
    if (!raw) return null;
    if (/^(?:https?:|data:|blob:)/i.test(raw)) return safeHref(raw, documentRef);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || /^[\\/]/.test(raw) || raw.indexOf('?') >= 0 || raw.indexOf('#') >= 0) return null;
    return '/vault-viewer/asset?ref=' + encodeURIComponent(documentRef) + '&path=' + encodeURIComponent(raw);
  }

  function sanitize(html, documentRef) {
    var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    Array.from(doc.body.querySelectorAll('*')).forEach(function (el) {
      if (!safeTags.has(el.tagName)) { el.replaceWith.apply(el, Array.from(el.childNodes)); return; }
      Array.from(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        if (name === 'class' && (el.tagName === 'CODE' || el.tagName === 'SPAN')) return;
        if (name === 'title' || name.indexOf('aria-') === 0) return;
        if (el.tagName === 'A' && name === 'href') {
          var href = safeHref(attr.value, documentRef);
          if (href) {
            el.setAttribute('href', href);
            if (/^https?:/i.test(href)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
          } else el.removeAttribute(attr.name);
          return;
        }
        if (el.tagName === 'IMG' && name === 'src') {
          var src = imageHref(attr.value, documentRef);
          if (src) el.setAttribute('src', src); else el.removeAttribute(attr.name);
          return;
        }
        if (el.tagName === 'IMG' && name === 'alt') return;
        el.removeAttribute(attr.name);
      });
      if (el.tagName === 'IMG' && el.hasAttribute('src')) { el.setAttribute('loading', 'lazy'); el.setAttribute('decoding', 'async'); }
    });
    return doc.body.innerHTML;
  }

  function slugify(value) {
    return String(value || '').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\\s-]/g, '').trim().replace(/\\s+/g, '-').replace(/-+/g, '-');
  }

  function assignHeadingIds() {
    var used = Object.create(null);
    Array.from(content.querySelectorAll('h1,h2,h3,h4,h5,h6')).forEach(function (heading) {
      var base = slugify(heading.textContent) || 'heading';
      var count = used[base] || 0;
      used[base] = count + 1;
      heading.id = count ? base + '-' + count : base;
    });
  }

  function scrollToHeading(heading) {
    if (!heading) return;
    var wanted = String(heading).trim();
    var wantedSlug = slugify(wanted);
    var match = Array.from(content.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(function (node) {
      return String(node.textContent || '').trim().toLowerCase() === wanted.toLowerCase() || node.id === wantedSlug;
    });
    if (match) requestAnimationFrame(function () { match.scrollIntoView({ block: 'start' }); });
  }

  function fail(message) {
    status.hidden = false; status.className = 'error'; status.textContent = message || 'Unable to load learning note.'; content.hidden = true;
  }

  function updateNavigationControls() {
    var previous = navigationIndex > 0 ? navigationEntries[navigationIndex - 1] : null;
    var next = navigationIndex >= 0 && navigationIndex < navigationEntries.length - 1 ? navigationEntries[navigationIndex + 1] : null;
    backButton.disabled = !previous;
    forwardButton.disabled = !next;
    backButton.title = previous && previous.title ? 'Back to ' + previous.title + ' (Alt+Left)' : 'Back (Alt+Left)';
    forwardButton.title = next && next.title ? 'Forward to ' + next.title + ' (Alt+Right)' : 'Forward (Alt+Right)';
  }

  function captureCurrentPosition() {
    if (navigationIndex < 0 || !navigationEntries[navigationIndex]) return;
    navigationEntries[navigationIndex].scrollY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
    navigationEntries[navigationIndex].title = title.textContent || navigationEntries[navigationIndex].title || '';
  }

  function loadNavigationEntry(entry) {
    var request = ++navigationRequest;
    if (navigationController) navigationController.abort();
    navigationController = new AbortController();
    status.hidden = false; status.className = ''; status.textContent = 'Loading…'; content.hidden = true;
    updateNavigationControls();
    fetch('/vault-viewer/document?ref=' + encodeURIComponent(entry.ref), {
      headers: { 'Accept': 'application/json' },
      signal: navigationController.signal,
    })
      .then(function (response) { return response.json().catch(function () { return {}; }).then(function (body) { if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status)); return body; }); })
      .then(function (body) {
        if (request !== navigationRequest) return;
        entry.ref = body.source || entry.ref;
        entry.title = body.title || 'Learning note';
        title.textContent = entry.title; source.textContent = entry.ref; document.title = entry.title + ' · Learning vault';
        var markdown = rewriteWikiLinks(String(body.markdown || ''), entry.ref);
        var rendered = window.marked ? window.marked.parse(markdown, { gfm: true, breaks: true }) : '<pre>' + markdown.replace(/[&<>]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]; }) + '</pre>';
        content.innerHTML = sanitize(rendered, entry.ref); assignHeadingIds(); status.hidden = true; content.hidden = false; updateNavigationControls();
        if (Number.isFinite(entry.scrollY)) requestAnimationFrame(function () { window.scrollTo(0, entry.scrollY); });
        else scrollToHeading(body.heading || '');
      })
      .catch(function (error) {
        if (request !== navigationRequest || (error && error.name === 'AbortError')) return;
        fail(error && error.message); updateNavigationControls();
      });
  }

  function navigateTo(nextRef) {
    if (!vaultParts(nextRef)) return;
    captureCurrentPosition();
    navigationEntries.splice(navigationIndex + 1);
    navigationEntries.push({ ref: nextRef, scrollY: null, title: '' });
    if (navigationEntries.length > maxNavigationEntries) navigationEntries.shift();
    navigationIndex = navigationEntries.length - 1;
    loadNavigationEntry(navigationEntries[navigationIndex]);
  }

  function moveInHistory(delta) {
    var nextIndex = navigationIndex + delta;
    if (nextIndex < 0 || nextIndex >= navigationEntries.length) return;
    captureCurrentPosition();
    navigationIndex = nextIndex;
    loadNavigationEntry(navigationEntries[navigationIndex]);
  }

  if (!ref) { fail('Missing learning-vault reference.'); updateNavigationControls(); return; }
  updateNavigationControls();
  loadNavigationEntry(navigationEntries[0]);
  backButton.addEventListener('click', function () { moveInHistory(-1); });
  forwardButton.addEventListener('click', function () { moveInHistory(1); });
  document.addEventListener('keydown', function (event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' && !backButton.disabled) { event.preventDefault(); moveInHistory(-1); }
    else if (event.key === 'ArrowRight' && !forwardButton.disabled) { event.preventDefault(); moveInHistory(1); }
  });

  content.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    if (href.charAt(0) === '#') {
      event.preventDefault();
      var current = navigationEntries[navigationIndex];
      var anchored = current ? noteHref(href, current.ref, false) : null;
      if (anchored) navigateTo(anchored);
    } else if (/^obsidian:/i.test(href)) { event.preventDefault(); navigateTo(href); }
    else if (/^qmd:/i.test(href)) { event.preventDefault(); location.href = '/qmd-viewer/?ref=' + encodeURIComponent(href); }
  });
})();
</script>
</body>
</html>`;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function loadAssetWithTimeout(task: (signal: AbortSignal) => Promise<VaultAsset>, requestSignal: AbortSignal): Promise<VaultAsset> {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(ASSET_TIMEOUT_MS)]);
  if (signal.aborted) throw new VaultDocumentError(504, "Learning-vault asset retrieval timed out.");
  return await new Promise<VaultAsset>((resolve, reject) => {
    const onAbort = () => reject(new VaultDocumentError(504, "Learning-vault asset retrieval timed out."));
    signal.addEventListener("abort", onAbort, { once: true });
    task(signal).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function handleVaultViewerRoute(req: Request, pathname: string, dependencies: VaultViewerRouteDependencies = {}): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });

  if (pathname === `${ROUTE_PREFIX}/asset`) {
    const params = new URL(req.url).searchParams;
    let reference: ParsedVaultReference;
    try { reference = parseVaultReference(params.get("ref") ?? ""); }
    catch (error) { return json({ error: error instanceof VaultReferenceError ? error.message : "Invalid learning-vault reference." }, 400); }
    try {
      const asset = await loadAssetWithTimeout(
        (signal) => (dependencies.fetchAsset ?? ((ref, path, assetSignal) => fetchVaultAsset(ref, path, undefined, assetSignal)))(reference, params.get("path") ?? "", signal),
        req.signal,
      );
      const headers = { "Content-Type": asset.mimeType, "Content-Length": String(asset.bytes.byteLength), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
      return new Response(req.method === "HEAD" ? null : Uint8Array.from(asset.bytes).buffer, { status: 200, headers });
    } catch (error) {
      if (error instanceof VaultDocumentError) return json({ error: error.message }, error.status);
      return json({ error: "Learning-vault asset retrieval failed." }, 502);
    }
  }

  if (pathname === `${ROUTE_PREFIX}/document`) {
    let reference: ParsedVaultReference;
    try { reference = parseVaultReference(new URL(req.url).searchParams.get("ref") ?? ""); }
    catch (error) { return json({ error: error instanceof VaultReferenceError ? error.message : "Invalid learning-vault reference." }, 400); }
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    try {
      const markdown = await (dependencies.fetchDocument ?? ((ref, signal) => fetchVaultDocument(ref, undefined, signal)))(reference, req.signal);
      return json({ title: reference.title, source: reference.uri, heading: reference.heading ?? null, markdown });
    } catch (error) {
      if (error instanceof VaultDocumentError) return json({ error: error.message }, error.status);
      return json({ error: "Learning-vault note retrieval failed." }, 502);
    }
  }

  if (pathname !== ROUTE_PREFIX && pathname !== `${ROUTE_PREFIX}/`) return new Response("Not Found", { status: 404 });
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": VIEWER_CSP };
  return new Response(req.method === "HEAD" ? null : generateVaultViewerPage(), { status: 200, headers });
}

registerExtensionRoute(ROUTE_PREFIX, handleVaultViewerRoute, import.meta.dir);
