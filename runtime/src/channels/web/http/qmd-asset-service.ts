import { realpath, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { WORKSPACE_DIR } from "../../../core/config.js";
import type { ParsedQmdReference } from "./qmd-reference.js";

export const MAX_QMD_ASSET_BYTES = 12 * 1024 * 1024;
const DEFAULT_CORPUS_ROOT = resolve(WORKSPACE_DIR, "resources", "Training", "QMD", "corpus");
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);

export interface QmdAsset {
  bytes: Uint8Array;
  mimeType: string;
}

export class QmdAssetError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "QmdAssetError";
  }
}

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  const ascii = (start: number, end: number) => new TextDecoder("ascii").decode(bytes.subarray(start, end));
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "image/avif";
  return null;
}

function extensionMatchesMime(extension: string, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return extension === ".jpg" || extension === ".jpeg";
  return mimeType === `image/${extension.slice(1)}`;
}

function resolveRelativeAssetPath(reference: ParsedQmdReference, rawAssetPath: string): string {
  if (!reference.collection || !reference.path) {
    throw new QmdAssetError(400, "QMD assets require a collection document reference.");
  }
  const raw = String(rawAssetPath || "").trim();
  if (!raw || raw.length > 2_048 || isAbsolute(raw) || raw.startsWith("/") || raw.startsWith("\\") || raw.startsWith("//")) {
    throw new QmdAssetError(400, "Invalid QMD asset path.");
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.includes("?") || raw.includes("#")) {
    throw new QmdAssetError(400, "QMD asset paths must be relative local paths.");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new QmdAssetError(400, "QMD asset path contains invalid percent encoding.");
  }
  if (!decoded || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded)) {
    throw new QmdAssetError(400, "Invalid QMD asset path.");
  }

  const normalized = posix.normalize(posix.join(posix.dirname(reference.path), decoded));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || posix.isAbsolute(normalized)) {
    throw new QmdAssetError(403, "QMD asset path escapes its collection.");
  }
  const extension = extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new QmdAssetError(415, "QMD asset type is not supported.");
  }
  return normalized;
}

/** Read one relative raster asset from the local mirror of the QMD corpus. */
export async function fetchQmdAsset(
  reference: ParsedQmdReference,
  rawAssetPath: string,
  corpusRoot = DEFAULT_CORPUS_ROOT,
  signal?: AbortSignal,
): Promise<QmdAsset> {
  const relativePath = resolveRelativeAssetPath(reference, rawAssetPath);
  let collectionRoot: string;
  try {
    collectionRoot = await realpath(join(corpusRoot, reference.collection!));
  } catch {
    throw new QmdAssetError(404, "QMD asset collection is unavailable.");
  }

  let candidate: string;
  try {
    candidate = await realpath(join(collectionRoot, relativePath));
  } catch {
    throw new QmdAssetError(404, "QMD asset not found.");
  }
  const rootPrefix = collectionRoot.endsWith(sep) ? collectionRoot : `${collectionRoot}${sep}`;
  if (!candidate.startsWith(rootPrefix)) throw new QmdAssetError(404, "QMD asset not found.");

  let info;
  try {
    info = await stat(candidate);
  } catch {
    throw new QmdAssetError(404, "QMD asset not found.");
  }
  if (!info.isFile()) throw new QmdAssetError(404, "QMD asset not found.");
  if (info.size < 1 || info.size > MAX_QMD_ASSET_BYTES) {
    throw new QmdAssetError(413, "QMD asset exceeds the 12 MiB viewer limit.");
  }

  const bytes = await readFile(candidate, { signal });
  if (bytes.byteLength > MAX_QMD_ASSET_BYTES) throw new QmdAssetError(413, "QMD asset exceeds the 12 MiB viewer limit.");
  const mimeType = detectImageMime(bytes);
  const extension = extname(candidate).toLowerCase();
  if (!mimeType || !extensionMatchesMime(extension, mimeType)) {
    throw new QmdAssetError(415, "QMD asset content type is not supported.");
  }
  return { bytes, mimeType };
}
