/**
 * web/handlers/media.ts – HTTP handlers for media upload and retrieval.
 *
 * Handles POST /media/upload (file upload) and GET /media/:id (download/thumbnail).
 * Media uploads are validated by MediaService (size + content-type checks).
 * Downloads use Content-Disposition: attachment for types that are not safe
 * browser media, preventing stored XSS via HTML/SVG file uploads.
 *
 * Consumers: web/http/dispatch-media.ts routes media paths here.
 */

import { resolveAudioContentType } from "../../../utils/audio-media.js";
import { buildContentDisposition } from "../http/content-disposition.js";
import { MediaService } from "../media/media-service.js";

const mediaService = new MediaService();

/** Minimal response contract needed by media endpoint handlers. */
export interface MediaResponseContext {
  /** Build JSON responses for media endpoint success/error payloads. */
  json(payload: unknown, status?: number): Response;
}

/**
 * Handle POST `/media` requests for media upload.
 * @param channel Response context used to encode JSON result payloads.
 * @param req Incoming HTTP request containing multipart form data with `file`.
 * @returns JSON response with created media metadata or validation errors.
 */
export async function handleMediaUpload(channel: MediaResponseContext, req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return channel.json({ error: "Invalid form data" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return channel.json({ error: "Missing file" }, 400);

  const result = await mediaService.createFromFile(file);
  return channel.json(result.body, result.status);
}

/**
 * Content types safe to serve inline (rendered by the browser).
 * All other types get Content-Disposition: attachment to force download
 * and prevent stored XSS (e.g., an uploaded HTML file executing JS).
 */
const INLINE_SAFE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
]);

function isInlineSafeType(contentType: string): boolean {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() || "";
  return INLINE_SAFE_TYPES.has(normalized) || resolveAudioContentType(contentType) !== null;
}

/**
 * Resolve media binary requests, including thumbnail and inline/attachment behavior.
 * @param channel Response context used for JSON errors.
 * @param id Media row id to fetch.
 * @param thumbnail Whether to return a thumbnail variant when available.
 * @returns Binary media response on success, or JSON error response when media is missing.
 */
export function handleMedia(channel: MediaResponseContext, id: number, thumbnail: boolean, req?: Request): Response {
  const result = mediaService.getMedia(id, thumbnail);
  if (result.status !== 200) return channel.json({ error: "Media not found" }, result.status);

  const storedContentType = result.contentType || "application/octet-stream";
  // Legacy/imported metadata can predate File's MIME validation. Never put
  // control characters or non-header code points into a response header.
  const contentType = Array.from(storedContentType).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code > 126;
  }) ? "application/octet-stream" : storedContentType;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "Content-Length": String(result.body.size),
    "Accept-Ranges": "bytes",
  };
  // Force download for types that are not safe browser media to prevent stored
  // XSS via HTML/SVG uploads. Audio remains inline so the native player can load it.
  // Include a concrete filename because iOS Safari can ignore the HTML download
  // attribute for PDFs and will otherwise open the response fullscreen.
  if (!isInlineSafeType(contentType)) {
    headers["Content-Disposition"] = buildContentDisposition("attachment", result.filename || `attachment-${id}`);
  }
  if (req?.method === "HEAD") return new Response(null, { headers });

  // Match the PDF source policy: one byte range, ignoring malformed/multipart
  // requests. Slice the stored Blob; never allocate based on the requested end.
  const match = req?.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    const size = result.body.size;
    const suffix = !match[1] ? Number(match[2]) : null;
    const start = suffix !== null ? Math.max(0, size - suffix) : Number(match[1]);
    const requestedEnd = suffix !== null || !match[2] ? size - 1 : Number(match[2]);
    const end = Math.min(requestedEnd, size - 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
      || (suffix !== null && !Number.isSafeInteger(suffix)) || start >= size || start > end || suffix === 0) {
      return new Response(null, { status: 416, headers: {
        ...headers, "Content-Range": `bytes */${size}`, "Content-Length": "0",
      } });
    }
    return new Response(result.body.slice(start, end + 1, contentType), { status: 206, headers: {
      ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1),
    } });
  }
  return new Response(result.body, { headers });
}

/**
 * Handle GET `/media/:id/info` metadata lookup requests.
 * @param channel Response context used to serialize JSON payloads.
 * @param id Media row id to inspect.
 * @returns JSON response containing media metadata or not-found status.
 */
export function handleMediaInfo(channel: MediaResponseContext, id: number): Response {
  const result = mediaService.getInfo(id);
  return channel.json(result.body, result.status);
}
