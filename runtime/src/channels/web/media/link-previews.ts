import { admitSqliteWrite } from "../../../db/sqlite-async-admission.js";
import { getDb } from "../../../db/connection.js";
/**
 * web/link-previews.ts – OpenGraph metadata fetching for URLs in messages.
 *
 * When a user posts a message containing URLs, this module fetches the
 * OpenGraph title, description, and image for each URL and stores them
 * as link_previews on the message. Results are broadcast via SSE so the
 * timeline can render rich link cards.
 *
 * Consumers: web/posts-service.ts triggers link preview fetching after
 *            a new user message is stored.
 */

import {
  createMedia,
  deleteUnreferencedMedia,
  getLinkPreviewImageCache,
  getMessageByRowId,
  purgeExpiredLinkPreviewImageCache,
  touchLinkPreviewImageCache,
  updateMessageLinkPreviews,
  upsertLinkPreviewImageCache,
} from "../../../db.js";
import { lookup } from "dns/promises";
import { extname } from "path";
import { isIP } from "net";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

/** OpenGraph metadata for a URL: title, description, image, site name. */
export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site_name?: string;
}

/** Channel contract required to schedule and broadcast link-preview updates. */
export interface LinkPreviewChannel {
  pendingLinkPreviews: Set<number>;
  broadcastEvent(eventType: string, data: unknown): void;
}

const log = createLogger("web.link-previews");

const MAX_URLS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_CHARS = 200_000;
const PREVIEW_IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PREVIEW_IMAGE_BYTES = 5 * 1024 * 1024;

const URL_REGEX = /https?:\/\/[\w\d#%/.:?@\[\]-]+/gi;
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "0.0.0.0",
  "::",
  "::1",
  "metadata.google.internal",
]);

function trimUrl(raw: string): string {
  return raw.replace(/[),.;!?]+$/g, "");
}

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = parseIPv4(ip);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fec0:")) return true; // link-local/site-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("2001:db8")) return true; // documentation range

  const mappedIndex = lower.lastIndexOf(":");
  if (mappedIndex !== -1) {
    const maybeIpv4 = lower.slice(mappedIndex + 1);
    if (maybeIpv4.includes(".")) {
      return isPrivateIPv4(maybeIpv4);
    }
  }

  return false;
}

function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true;
}

async function isSafeUrl(raw: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (!parsed.protocol || !["http:", "https:"].includes(parsed.protocol)) return false;

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return false;
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;

  if (isIP(hostname)) {
    return !isPrivateIp(hostname);
  }

  try {
    const results = await lookup(hostname, { all: true, verbatim: true });
    if (!results.length) return false;
    return results.every((entry) => !isPrivateIp(entry.address));
  } catch {
    return false;
  }
}

export function stripMarkdownCodeBlocks(text: string): string {
  if (!text) return "";
  const lines = String(text).split(/(\r?\n)/);
  const kept: string[] = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let atLineStart = true;
  let currentLine = "";

  const flushLine = (newline = "") => {
    const fenceMatch = currentLine.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLength = marker.length;
        currentLine = "";
        atLineStart = true;
        return;
      }
      if (marker[0] === fenceChar && marker.length >= fenceLength) {
        inFence = false;
        fenceChar = "";
        fenceLength = 0;
      }
      currentLine = "";
      atLineStart = true;
      return;
    }

    const isIndentedCode = /^ {4,}\S/.test(currentLine) || /^\t\S/.test(currentLine);
    if (!inFence && !isIndentedCode) kept.push(currentLine, newline);
    currentLine = "";
    atLineStart = true;
  };

  for (const part of lines) {
    if (part === "\n" || part === "\r\n") {
      flushLine(part);
      continue;
    }
    if (atLineStart) atLineStart = false;
    currentLine += part;
  }
  if (currentLine) flushLine("");
  return kept.join("");
}

/** Extract HTTP/HTTPS URLs from a text string, ignoring Markdown code blocks. */
export function extractUrls(text: string, limit = MAX_URLS): string[] {
  if (!text) return [];
  const searchableText = stripMarkdownCodeBlocks(text);
  const matches = searchableText.match(URL_REGEX) ?? [];
  const unique: string[] = [];
  for (const raw of matches) {
    const cleaned = trimUrl(raw);
    if (!cleaned) continue;
    if (!unique.includes(cleaned)) unique.push(cleaned);
    if (unique.length >= limit) break;
  }
  return unique;
}

function extractMetaContent(html: string, key: string): string | undefined {
  const attrMatch = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"));
  if (!attrMatch) return undefined;
  const contentMatch = attrMatch[0].match(/content=["']([^"']+)["']/i);
  return contentMatch?.[1];
}

function extractTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch?.[1]?.trim();
}

function decodeHtmlEntities(value: string | undefined): string | undefined {
  if (!value) return value;
  const entityMap: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, code) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const num = parseInt(code.slice(2), 16);
      if (!Number.isFinite(num)) return match;
      return String.fromCharCode(num);
    }
    if (code.startsWith("#")) {
      const num = parseInt(code.slice(1), 10);
      if (!Number.isFinite(num)) return match;
      return String.fromCharCode(num);
    }
    const mapped = entityMap[code];
    return mapped ?? match;
  });
}

function normalizeImage(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function getCachedMediaPath(mediaId: number): string {
  return `/media/${mediaId}`;
}

function getCacheExpiry(nowIso: string): string {
  const now = Date.parse(nowIso);
  return new Date((Number.isFinite(now) ? now : Date.now()) + PREVIEW_IMAGE_CACHE_TTL_MS).toISOString();
}

function inferImageExtension(contentType: string): string {
  const normalized = contentType.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
    "image/x-icon": ".ico",
  };
  return map[normalized] || "";
}

function buildCachedPreviewFilename(imageUrl: string, contentType: string): string {
  try {
    const parsed = new URL(imageUrl);
    const rawName = parsed.pathname.split("/").filter(Boolean).pop() || "link-preview-image";
    const cleanName = rawName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "link-preview-image";
    const extension = extname(cleanName) || inferImageExtension(contentType) || ".img";
    if (extname(cleanName)) return cleanName;
    return `${cleanName}${extension}`;
  } catch {
    return `link-preview-image${inferImageExtension(contentType) || ".img"}`;
  }
}

async function cachePreviewImage(imageUrl: string): Promise<string | undefined> {
  const nowIso = new Date().toISOString();
  const database = getDb();
  const binding = () => { if (getDb() !== database) throw Error("Link preview database changed"); };
  const cached = await admitSqliteWrite(database, () => {
    purgeExpiredLinkPreviewImageCache(nowIso);
    const row = getLinkPreviewImageCache(imageUrl);
    if (row && Date.parse(row.expires_at) > Date.now()) {
      touchLinkPreviewImageCache(imageUrl, nowIso);
      return row;
    }
    return null;
  }, undefined, undefined, undefined, binding);
  if (cached) return getCachedMediaPath(cached.media_id);

  const allowed = await isSafeUrl(imageUrl);
  if (!allowed) return undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "piclaw/1.0",
        Accept: "image/*",
      },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return undefined;

    const declaredLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PREVIEW_IMAGE_BYTES) return undefined;

    const rawBytes = new Uint8Array(await response.arrayBuffer());
    if (rawBytes.byteLength === 0 || rawBytes.byteLength > MAX_PREVIEW_IMAGE_BYTES) return undefined;

    // Optimize the OG image: resize to timeline-friendly dimensions and convert to WebP.
    let bytes = rawBytes;
    let effectiveContentType = contentType.split(";")[0] || "application/octet-stream";
    try {
      const { optimizeLinkPreviewImage } = await import("../../../utils/image-processing.js");
      const optimized = await optimizeLinkPreviewImage(Buffer.from(rawBytes));
      if (optimized) {
        bytes = new Uint8Array(optimized.data);
        effectiveContentType = optimized.mimeType;
      }
    } catch (error) {
      debugSuppressedError(log, "Link preview image optimisation failed; using original.", error);
    }

    const mediaId = await admitSqliteWrite(database, () => {
      const created = createMedia(
        buildCachedPreviewFilename(imageUrl, effectiveContentType),
        effectiveContentType,
        bytes,
        null,
        {
          size: bytes.byteLength,
          source_url: imageUrl,
          cache_kind: "link_preview_image",
          ttl_ms: PREVIEW_IMAGE_CACHE_TTL_MS,
        }
      );
      const replacedMediaIds = upsertLinkPreviewImageCache(
        imageUrl,
        created,
        nowIso,
        getCacheExpiry(nowIso),
        nowIso,
      );
      if (replacedMediaIds.length > 0) {
        deleteUnreferencedMedia(replacedMediaIds);
      }
      return created;
    }, undefined, controller.signal, undefined, binding);
    return getCachedMediaPath(mediaId);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Fetch OpenGraph metadata for a single URL. */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  const allowed = await isSafeUrl(url);
  if (!allowed) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "piclaw/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;

    const html = (await res.text()).slice(0, MAX_HTML_CHARS);
    const titleRaw =
      extractMetaContent(html, "og:title") ||
      extractMetaContent(html, "twitter:title") ||
      extractTitle(html);
    const descriptionRaw =
      extractMetaContent(html, "og:description") ||
      extractMetaContent(html, "twitter:description") ||
      extractMetaContent(html, "description");
    const imageRaw =
      extractMetaContent(html, "og:image") ||
      extractMetaContent(html, "twitter:image") ||
      extractMetaContent(html, "og:image:url");
    const siteNameRaw = extractMetaContent(html, "og:site_name") || new URL(url).hostname;
    const title = decodeHtmlEntities(titleRaw)?.trim();
    const description = decodeHtmlEntities(descriptionRaw)?.trim();
    const siteName = decodeHtmlEntities(siteNameRaw)?.trim();
    const imageDecoded = decodeHtmlEntities(imageRaw)?.trim();
    const imageUrl = imageDecoded ? normalizeImage(imageDecoded, url) : undefined;
    const image = imageUrl ? (await cachePreviewImage(imageUrl)) || imageUrl : undefined;

    if (!title && !description && !image) return null;

    return {
      url,
      title: title || undefined,
      description: description || undefined,
      image,
      site_name: siteName || undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Fetch OpenGraph metadata for multiple URLs in parallel. */
export async function fetchLinkPreviews(urls: string[]): Promise<LinkPreview[]> {
  const previews: LinkPreview[] = [];
  for (const url of urls) {
    const preview = await fetchLinkPreview(url);
    if (preview) previews.push(preview);
  }
  return previews;
}

/** Asynchronously fetch link previews for a message and broadcast updates. */
export function scheduleLinkPreviews(
  channel: LinkPreviewChannel,
  chatJid: string,
  rowId: number,
  content: string,
  existingPreviews?: unknown[]
): void {
  if (existingPreviews && existingPreviews.length > 0) return;
  const urls = extractUrls(content);
  if (urls.length === 0) return;
  if (channel.pendingLinkPreviews.has(rowId)) return;

  channel.pendingLinkPreviews.add(rowId);
  void (async () => {
    try {
      const previews = await fetchLinkPreviews(urls);
      if (!previews.length) return;
      const database = getDb();
      await admitSqliteWrite(database, () => updateMessageLinkPreviews(chatJid, rowId, previews), undefined, undefined, undefined,
        () => { if (getDb() !== database) throw Error("Link preview database changed"); });
      const interaction = getMessageByRowId(chatJid, rowId);
      if (interaction) channel.broadcastEvent("interaction_updated", interaction);
    } catch (error) {
      log.warn("Link preview fetch failed", {
        operation: "web_link_previews.schedule_link_previews",
        chatJid,
        rowId,
        err: error,
      });
    } finally {
      channel.pendingLinkPreviews.delete(rowId);
    }
  })();
}
