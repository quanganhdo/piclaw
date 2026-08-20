/**
 * web/media-service.ts – File upload and retrieval service.
 *
 * Wraps db/media.ts operations with validation:
 *   - File size limit (configurable; default 32 MB) — returns 413 if exceeded
 *   - Content-type normalization (non-image types are served as downloads)
 *
 * Consumers: web/handlers/media.ts delegates to MediaService methods.
 */

import { readFileSync, statSync } from "fs";
import { basename, extname } from "path";
import { createMedia, getMediaById, getMediaInfoById } from "../../../db.js";
import { getWebRuntimeConfig } from "../../../core/config.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.media");

/**
 * Resolve the current compose/media upload size in bytes.
 * This is enforced at the application level. The Bun.serve()
 * maxRequestBodySize (512 MB) is a separate hard cap.
 */
function getMaxMediaUploadBytes(): number {
  return Math.max(1, Math.round((getWebRuntimeConfig().composeUploadLimitMb || 32) * 1024 * 1024));
}

/**
 * File upload/download service wrapping db/media.ts operations.
 * Validates size and normalizes content type before persisting.
 */
const normalizeContentType = (value: string | undefined, fallback?: string): string => {
  const type = (value || fallback || "application/octet-stream").toLowerCase();
  return type || "application/octet-stream";
};

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".csv": "text/csv",
  ".html": "text/html",
  ".xml": "text/xml",
  ".json": "application/json",
  ".sh": "text/x-shellscript",
  ".bash": "text/x-shellscript",
  ".zsh": "text/x-shellscript",
  ".zip": "application/zip",
  ".gz": "application/gzip",
};

const inferContentTypeFromPath = (filePath: string): string => {
  const extension = extname(filePath).toLowerCase();
  return EXTENSION_MEDIA_TYPES[extension] || "application/octet-stream";
};

const TEXT_SNIFF_EXTENSIONS = new Set([".sb"]);

function isProbablyTextData(data: Uint8Array): boolean {
  if (!(data instanceof Uint8Array) || data.length === 0) return true;
  const sample = data.subarray(0, Math.min(data.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12;
    if (isControl) suspicious += 1;
  }
  return suspicious / sample.length < 0.02;
}

function maybePromoteUnknownTextType(pathLike: string, contentType: string, data: Uint8Array): string {
  const normalized = normalizeContentType(contentType);
  const extension = extname(pathLike).toLowerCase();
  if (normalized !== "application/octet-stream") return normalized;
  if (!TEXT_SNIFF_EXTENSIONS.has(extension)) return normalized;
  return isProbablyTextData(data) ? "text/plain" : normalized;
}

/**
 * Service for validating and persisting uploaded media blobs.
 *
 * Used by web handlers and IPC path-based ingestion to create media rows and
 * retrieve media payloads/metadata for rendering and downloads.
 */
export class MediaService {
  /**
   * Validate and store an uploaded file.
   * Returns 413 if file exceeds the configured compose/media upload limit.
   */
  async createFromFile(file: File): Promise<{ status: number; body: unknown }> {
    // Size check — reject before reading the full body into memory
    const maxMediaUploadBytes = getMaxMediaUploadBytes();
    if (file.size > maxMediaUploadBytes) {
      return {
        status: 413,
        body: { error: `File too large (max ${maxMediaUploadBytes / 1024 / 1024} MB)` },
      };
    }

    const detectedContentType = normalizeContentType(file.type, inferContentTypeFromPath(file.name || "upload"));

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const contentType = maybePromoteUnknownTextType(file.name || "upload", detectedContentType, data);

    // Generate a thumbnail for image uploads
    let thumbnail: Uint8Array | null = null;
    if (contentType.startsWith("image/") && !contentType.includes("svg")) {
      try {
        const { generateThumbnail } = await import("../../../utils/image-processing.js");
        const thumb = await generateThumbnail(Buffer.from(data));
        if (thumb) thumbnail = new Uint8Array(thumb.data);
      } catch (error) {
        debugSuppressedError(log, "Thumbnail generation failed; skipping.", error);
      }
    }

    const mediaId = createMedia(
      file.name || "upload",
      contentType,
      data,
      thumbnail,
      { size: file.size }
    );

    return { status: 200, body: { id: mediaId, filename: file.name, size: file.size, contentType } };
  }

  /**
   * Validate and store a file by filesystem path.
   * Returns 413 if file exceeds the configured compose/media upload limit.
   * Returns 404 if the file does not exist.
   */
  async createFromPath(filePath: string, contentTypeOverride?: string, filenameOverride?: string): Promise<{ status: number; body: unknown }> {
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(filePath);
    } catch {
      return { status: 404, body: { error: `Media file not found: ${filePath}` } };
    }

    if (!stats.isFile()) {
      return { status: 400, body: { error: `Media path is not a regular file: ${filePath}` } };
    }

    const maxMediaUploadBytes = getMaxMediaUploadBytes();
    if (stats.size > maxMediaUploadBytes) {
      return {
        status: 413,
        body: { error: `File too large (max ${maxMediaUploadBytes / 1024 / 1024} MB)` },
      };
    }

    const detectedContentType = normalizeContentType(contentTypeOverride, inferContentTypeFromPath(filePath));

    let data: Uint8Array;
    try {
      data = new Uint8Array(readFileSync(filePath));
    } catch {
      return { status: 500, body: { error: `Unable to read media file: ${filePath}` } };
    }

    const contentType = maybePromoteUnknownTextType(filenameOverride || filePath, detectedContentType, data);

    // Generate a thumbnail for image uploads
    let thumbnail: Uint8Array | null = null;
    if (contentType.startsWith("image/") && !contentType.includes("svg")) {
      try {
        const { generateThumbnail } = await import("../../../utils/image-processing.js");
        const thumb = await generateThumbnail(Buffer.from(data));
        if (thumb) thumbnail = new Uint8Array(thumb.data);
      } catch (error) {
        debugSuppressedError(log, "Thumbnail generation failed; skipping.", error);
      }
    }

    const mediaId = createMedia(
      filenameOverride || basename(filePath),
      contentType,
      data,
      thumbnail,
      { size: stats.size }
    );

    return {
      status: 200,
      body: {
        id: mediaId,
        filename: filenameOverride || basename(filePath),
        size: stats.size,
        contentType,
      },
    };
  }

  getMedia(id: number, thumbnail: boolean): { status: number; body: Blob; contentType?: string; filename?: string } {
    const media = getMediaById(id);
    if (!media) return { status: 404, body: new Blob([JSON.stringify({ error: "Media not found" })]) };

    const blob = thumbnail && media.thumbnail ? media.thumbnail : media.data;
    const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer;
    const body = new Blob([buffer], { type: media.content_type });
    return { status: 200, body, contentType: media.content_type, filename: media.filename };
  }

  getInfo(id: number): { status: number; body: unknown } {
    const info = getMediaInfoById(id);
    if (!info) return { status: 404, body: { error: "Media not found" } };
    return { status: 200, body: info };
  }
}
