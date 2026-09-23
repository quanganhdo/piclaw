/**
 * web/avatar-service.ts – Manages agent and user avatar images.
 *
 * Handles avatar upload, retrieval, and storage on disk. Supports both
 * URL-based avatars and file-upload avatars stored under the workspace's
 * .piclaw/data/avatars directory.
 *
 * Consumers: web/handlers/agent.ts serves and updates avatar images.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync } from "fs";
import { resolve, extname } from "path";
import { fileURLToPath } from "url";

import { WORKSPACE_DIR } from "../../../core/config.js";
import { getMediaById } from "../../../db/media.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { validatePublicHttpUrl } from "./url-safety.js";
import { contentTypeForPath } from "../workspace/file-utils.js";

const log = createLogger("web.avatar");

/** AvatarKind type definition. */
export type AvatarKind = "agent" | "user";

interface AvatarMeta {
  source: string;
  file: string;
  contentType: string;
  updatedAt: string;
  revision?: string;
}

const AVATAR_DIR = resolve(WORKSPACE_DIR, ".piclaw", "avatars");
const MAX_REMOTE_AVATAR_BYTES = 5 * 1024 * 1024;
const REMOTE_AVATAR_TIMEOUT_MS = 8000;
const REMOTE_AVATAR_MAX_REDIRECTS = 3;

const EXT_TO_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const TYPE_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
};

function normalizeContentType(value: string | null | undefined): string {
  return (value || "").split(";")[0].trim().toLowerCase();
}

function sanitizeAvatarSource(source: string): string {
  let cleaned = (source || "").trim();
  if (!cleaned) return "";
  cleaned = cleaned.replace(/\r\n/g, "\n");
  const blockIndex = cleaned.indexOf("\nFiles:");
  if (blockIndex !== -1) cleaned = cleaned.slice(0, blockIndex);
  const inlineIndex = cleaned.indexOf(" Files:");
  if (inlineIndex !== -1) cleaned = cleaned.slice(0, inlineIndex);
  return cleaned.trim();
}

function guessContentTypeFromExtension(ext: string): string {
  return EXT_TO_TYPE[ext.toLowerCase()] || "application/octet-stream";
}

function guessExtension(contentType: string, source: string): string {
  const normalized = normalizeContentType(contentType);
  const byType = TYPE_TO_EXT[normalized];
  if (byType) return byType;
  const ext = extname(source.split("?")[0]);
  if (ext) return ext;
  return ".img";
}

function readMeta(kind: AvatarKind): AvatarMeta | null {
  const metaPath = resolve(AVATAR_DIR, `${kind}.json`);
  if (!existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf-8"));
    if (parsed && typeof parsed === "object") {
      const record = parsed as AvatarMeta;
      if (record.source && record.file && record.contentType) return record;
    }
  } catch (error) {
    debugSuppressedError(log, "Failed to read cached avatar metadata; ignoring the stale metadata file.", error, {
      kind,
      metaPath,
    });
    return null;
  }
  return null;
}

function writeMeta(kind: AvatarKind, meta: AvatarMeta): void {
  const metaPath = resolve(AVATAR_DIR, `${kind}.json`);
  mkdirSync(AVATAR_DIR, { recursive: true });
  const temporary = `${metaPath}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, `${JSON.stringify(meta, null, 2)}\n`, "utf-8"); renameSync(temporary, metaPath); }
  finally { cleanupFile(temporary); }
}

function cleanupFile(pathname: string | undefined): void {
  if (!pathname) return;
  try {
    if (existsSync(pathname)) rmSync(pathname);
  } catch (error) {
    debugSuppressedError(log, "Failed to remove superseded avatar file.", error, {
      pathname,
    });
  }
}

async function readRemoteAvatarBytes(response: Response): Promise<Uint8Array | null> {
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_AVATAR_BYTES) return null;
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
    total += chunk.length;
    if (total > MAX_REMOTE_AVATAR_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function isRemoteAvatarUrlAllowed(source: string): Promise<boolean> {
  return Boolean(await validatePublicHttpUrl(source));
}

async function loadRemoteAvatar(source: string): Promise<{ data: Uint8Array; contentType: string } | null> {
  try {
    let current = source;
    for (let redirects = 0; redirects <= REMOTE_AVATAR_MAX_REDIRECTS; redirects += 1) {
      const safeUrl = await validatePublicHttpUrl(current);
      if (!safeUrl) return null;

      const response = await fetch(safeUrl.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(REMOTE_AVATAR_TIMEOUT_MS),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) return null;
        current = new URL(location, safeUrl).href;
        continue;
      }
      if (!response.ok) return null;
      const contentType = normalizeContentType(response.headers.get("content-type"));
      if (contentType && !contentType.startsWith("image/")) return null;
      const buffer = await readRemoteAvatarBytes(response);
      if (!buffer) return null;
      return {
        data: buffer,
        contentType: contentType || "application/octet-stream",
      };
    }
    return null;
  } catch (error) {
    debugSuppressedError(log, "Failed to load remote avatar source.", error, {
      source,
      maxBytes: MAX_REMOTE_AVATAR_BYTES,
    });
    return null;
  }
}

function loadLocalAvatar(source: string): { data: Uint8Array; contentType: string } | null {
  const path = source.startsWith("file://") ? fileURLToPath(source) : source;
  if (!existsSync(path)) return null;
  const data = readFileSync(path);
  const contentType = contentTypeForPath(path);
  return { data: new Uint8Array(data), contentType };
}

function loadDataAvatar(source: string): { data: Uint8Array; contentType: string } | null {
  const match = source.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;
  const contentType = normalizeContentType(match[1] || "application/octet-stream");
  if (contentType && !contentType.startsWith("image/")) return null;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  try {
    const raw = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf-8");
    return { data: new Uint8Array(raw), contentType: contentType || "application/octet-stream" };
  } catch (error) {
    debugSuppressedError(log, "Failed to decode inline avatar data URI.", error, {
      contentType: contentType || "application/octet-stream",
      isBase64,
      payloadLength: payload.length,
    });
    return null;
  }
}

function parseMediaAvatarId(source: string): number | null {
  try {
    const url = new URL(source, "http://localhost");
    const match = url.pathname.match(/^\/media\/(\d+)\/?$/);
    if (!match) return null;
    const id = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function loadMediaAvatar(source: string): { data: Uint8Array; contentType: string } | null {
  const id = parseMediaAvatarId(source);
  if (id === null) return null;
  const record = getMediaById(id);
  const contentType = normalizeContentType(record?.content_type);
  if (!record || !contentType.startsWith("image/")) return null;
  return { data: new Uint8Array(record.data), contentType };
}

async function loadAvatarSource(source: string): Promise<{ data: Uint8Array; contentType: string } | null> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return await loadRemoteAvatar(source);
  }
  if (source.startsWith("data:")) {
    return loadDataAvatar(source);
  }
  if (source.startsWith("/media/")) {
    return loadMediaAvatar(source);
  }
  return loadLocalAvatar(source);
}

/**
 * Content types that are valid for use in webapp manifests and as
 * apple-touch-icon images. SVG and ICO are excluded because most
 * browsers require raster images for PWA icons.
 */
const MANIFEST_ICON_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** Check whether a content type is valid for manifest/PWA icons. */
export function isManifestIconType(contentType: string): boolean {
  return MANIFEST_ICON_TYPES.has(normalizeContentType(contentType));
}

/** Ensure the avatar cache directory exists on disk. */
const cacheWork = new Map<AvatarKind, Promise<AvatarMeta | null>>();
export async function ensureAvatarCache(kind: AvatarKind, source: string, options: { refresh?: boolean } = {}): Promise<AvatarMeta | null> {
  const prior = cacheWork.get(kind);
  const work = (prior ? prior.catch(() => null) : Promise.resolve()).then(() => {
    // A passive request may have captured the old config while an explicit update
    // was fetching. Do not let it roll the newly committed cache back afterwards.
    const current = readMeta(kind);
    if (prior && !options.refresh && current && current.source !== sanitizeAvatarSource(source) && existsSync(current.file)) return current;
    return prepareAvatarCache(kind, source, options);
  });
  cacheWork.set(kind, work);
  try { return await work; } finally { if (cacheWork.get(kind) === work) cacheWork.delete(kind); }
}

async function prepareAvatarCache(kind: AvatarKind, source: string, options: { refresh?: boolean }): Promise<AvatarMeta | null> {
  const sanitized = sanitizeAvatarSource(source);
  if (!sanitized) return null;

  const existing = readMeta(kind);
  if (!options.refresh && existing && existing.source === sanitized && existsSync(existing.file)) {
    return existing;
  }

  const loaded = await loadAvatarSource(sanitized);
  if (!loaded) {
    if (options.refresh) throw new Error(`Failed to load ${kind} avatar image.`);
    if (existing && existsSync(existing.file)) {
      log.warn("Failed to refresh avatar; keeping cached copy", {
        operation: "web_avatar.ensure_avatar_cache.keep_cached_copy",
        kind,
        source: sanitized,
        existingSource: existing.source,
      });
      return existing;
    }
    return null;
  }

  const normalizedType = normalizeContentType(loaded.contentType);
  if (kind === "agent" && !isManifestIconType(normalizedType)) {
    log.warn("Agent avatar content type is not valid for PWA manifest icons", {
      operation: "web_avatar.ensure_avatar_cache.invalid_manifest_icon_type",
      contentType: normalizedType,
      expectedTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    });
  }

  const extension = guessExtension(loaded.contentType, sanitized);

  // Optimize avatar: resize, strip EXIF, convert to WebP. Agent avatars are
  // kept at 512px so manifest / install surfaces can derive proper 192/512
  // raster variants without the browser falling back to undersized icons.
  let avatarData: Buffer | Uint8Array = loaded.data;
  let contentType = normalizeContentType(loaded.contentType) || guessContentTypeFromExtension(extension);
  let effectiveExtension = extension;
  try {
    const { processAvatar } = await import("../../../utils/image-processing.js");
    const processed = await processAvatar(Buffer.from(loaded.data), {
      size: kind === "agent" ? 512 : 256,
    });
    if (!processed && options.refresh) throw new Error(`Failed to decode ${kind} avatar image.`);
    if (processed) {
      avatarData = processed.data;
      contentType = processed.mimeType;
      effectiveExtension = contentType === "image/webp" ? ".webp" : extension;
    }
  } catch (error) {
    if (options.refresh) throw error;
    debugSuppressedError(log, "Avatar image processing failed; using original.", error);
  }

  const revision = createHash("sha256").update(avatarData).digest("hex");
  const filePath = resolve(AVATAR_DIR, `${kind}-${revision}${effectiveExtension}`);
  mkdirSync(AVATAR_DIR, { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, Buffer.from(avatarData)); renameSync(temporary, filePath); }
  finally { cleanupFile(temporary); }

  const meta: AvatarMeta = {
    source: sanitized,
    file: filePath,
    contentType,
    updatedAt: new Date().toISOString(),
    revision,
  };
  writeMeta(kind, meta);
  if (existing && existing.file !== filePath) cleanupFile(existing.file);
  return meta;
}

/** Build an HTTP response serving an avatar image with caching headers. */
export async function buildAvatarResponse(kind: AvatarKind, source: string, req: Request): Promise<Response | null> {
  const sanitized = sanitizeAvatarSource(source);
  if (!sanitized) return null;

  const meta = await ensureAvatarCache(kind, sanitized);
  if (!meta) {
    if (sanitized.startsWith("http://") || sanitized.startsWith("https://")) {
      if (!(await isRemoteAvatarUrlAllowed(sanitized))) return null;
      return Response.redirect(sanitized, 302);
    }
    return null;
  }

  // Snapshot bytes before another explicit update replaces/deletes a cached file.
  const bytes = readFileSync(meta.file);
  const file = new Blob([bytes]);

  // Support ?format=png and ?size=<n> for favicon / manifest / install icon use.
  const url = new URL(req.url, "http://localhost");
  const requestedFormat = String(url.searchParams.get("format") || "").trim().toLowerCase();
  const wantsPng = requestedFormat === "png";
  const requestedSizeRaw = Number(url.searchParams.get("size"));
  const requestedSize = Number.isFinite(requestedSizeRaw) && requestedSizeRaw > 0
    ? Math.max(16, Math.min(1024, Math.round(requestedSizeRaw)))
    : null;
  const maskable = url.searchParams.get("purpose") === "maskable";
  const needsRasterTransform = Boolean(requestedSize) || wantsPng;
  if (needsRasterTransform) {
    try {
      const sharp = (await import("sharp")).default;
      // HEAD has the same representation headers, without decoding/encoding pixels.
      if (req.method === "HEAD") return new Response(null, { headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" } });
      let pipeline = sharp(bytes).rotate();
      if (requestedSize && maskable) {
        const inner = Math.floor(requestedSize * 0.56); // Entire square fits inside the central 80%-diameter safe circle.
        const inset = await pipeline.resize(inner, inner, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).png().toBuffer();
        pipeline = sharp({ create: { width: requestedSize, height: requestedSize, channels: 3, background: "#ffffff" } }).composite([{ input: inset, gravity: "centre" }]);
      } else if (requestedSize) {
        pipeline = pipeline.resize(requestedSize, requestedSize, {
          fit: "cover",
          position: "center",
          withoutEnlargement: false,
        });
      }
      if (wantsPng || requestedSize) {
        const pngBuf = await pipeline.png().toBuffer();
        return new Response(new Uint8Array(pngBuf), {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(pngBuf.byteLength),
            "Cache-Control": "no-cache",
          },
        });
      }
    } catch (e) {
      // A requested PNG must never silently return a different image format.
      log.debug("Raster avatar transform unavailable", { err: e, requestedSize, requestedFormat });
      return null;
    }
  }

  const size = file.size ?? 0;
  const headers: Record<string, string> = {
    "Content-Type": meta.contentType || "application/octet-stream",
    "Content-Length": String(size),
    "Cache-Control": "no-store",
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(file, { status: 200, headers });
}

/** Resolve an avatar config value to a servable URL path. */
export function resolveAvatarUrl(kind: AvatarKind, source?: string | null): string | null {
  if (!source) return null;
  const sanitized = sanitizeAvatarSource(source);
  if (!sanitized) return null;
  const meta = readMeta(kind);
  const revision = meta?.source === sanitized ? (meta.revision || meta.updatedAt) : null;
  return `/avatar/${kind}${revision ? `?v=${encodeURIComponent(revision)}` : ""}`;
}
