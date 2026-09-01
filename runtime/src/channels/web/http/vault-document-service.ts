import { realpath, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, posix, resolve, sep } from "node:path";
import { WORKSPACE_DIR } from "../../../core/config.js";
import type { ParsedVaultReference } from "./vault-reference.js";

export const MAX_VAULT_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_VAULT_ASSET_BYTES = 12 * 1024 * 1024;
const DEFAULT_VAULT_ROOT = resolve(WORKSPACE_DIR, "vaults", "learning");
const ALLOWED_ASSET_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".pdf"]);

export interface VaultAsset {
  bytes: Uint8Array;
  mimeType: string;
}

export class VaultDocumentError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "VaultDocumentError";
  }
}

function isContained(root: string, candidate: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(prefix);
}

async function resolveContainedFile(rootPath: string, relativePath: string, notFoundMessage: string): Promise<string> {
  let root: string;
  let candidate: string;
  try {
    root = await realpath(rootPath);
    const lexicalCandidate = resolve(root, relativePath);
    candidate = await realpath(lexicalCandidate);
    // Exact equality rejects symlinks in addition to rejecting realpath escapes.
    if (candidate !== lexicalCandidate) throw new VaultDocumentError(404, notFoundMessage);
  } catch {
    throw new VaultDocumentError(404, notFoundMessage);
  }
  if (!isContained(root, candidate)) throw new VaultDocumentError(404, notFoundMessage);
  let info;
  try {
    info = await stat(candidate);
  } catch {
    throw new VaultDocumentError(404, notFoundMessage);
  }
  if (!info.isFile()) throw new VaultDocumentError(404, notFoundMessage);
  return candidate;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function resolveRelativeAssetPath(reference: ParsedVaultReference, rawAssetPath: string): string {
  const raw = String(rawAssetPath || "").trim();
  if (!raw || raw.length > 2_048 || isAbsolute(raw) || raw.startsWith("/") || raw.startsWith("\\") || raw.startsWith("//")) {
    throw new VaultDocumentError(400, "Invalid learning-vault asset path.");
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.includes("?") || raw.includes("#")) {
    throw new VaultDocumentError(400, "Learning-vault assets must use relative local paths.");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new VaultDocumentError(400, "Learning-vault asset path contains invalid percent encoding.");
  }
  if (!decoded || decoded.includes("\\") || containsControlCharacter(decoded)) {
    throw new VaultDocumentError(400, "Invalid learning-vault asset path.");
  }
  const normalized = posix.normalize(posix.join(posix.dirname(reference.path), decoded));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || posix.isAbsolute(normalized)) {
    throw new VaultDocumentError(403, "Learning-vault asset path escapes the vault.");
  }
  if (!ALLOWED_ASSET_EXTENSIONS.has(extname(normalized).toLowerCase())) {
    throw new VaultDocumentError(415, "Learning-vault asset type is not supported.");
  }
  return normalized;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder("ascii").decode(bytes.subarray(start, end));
}

function detectAssetMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 12))) return "image/avif";
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

function extensionMatchesMime(extension: string, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return extension === ".jpg" || extension === ".jpeg";
  if (mimeType === "application/pdf") return extension === ".pdf";
  return mimeType === `image/${extension.slice(1)}`;
}

/** Read one bounded Markdown note from the configured learning vault. */
export async function fetchVaultDocument(
  reference: ParsedVaultReference,
  vaultRoot = DEFAULT_VAULT_ROOT,
  signal?: AbortSignal,
): Promise<string> {
  const candidate = await resolveContainedFile(vaultRoot, reference.path, "Learning-vault note not found.");
  const info = await stat(candidate);
  if (info.size < 1 || info.size > MAX_VAULT_DOCUMENT_BYTES) {
    throw new VaultDocumentError(413, "Learning-vault note exceeds the 2 MiB viewer limit.");
  }
  const bytes = await readFile(candidate, { signal });
  if (bytes.byteLength > MAX_VAULT_DOCUMENT_BYTES) throw new VaultDocumentError(413, "Learning-vault note exceeds the 2 MiB viewer limit.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Read one allowlisted relative resource from the configured learning vault. */
export async function fetchVaultAsset(
  reference: ParsedVaultReference,
  rawAssetPath: string,
  vaultRoot = DEFAULT_VAULT_ROOT,
  signal?: AbortSignal,
): Promise<VaultAsset> {
  const relativePath = resolveRelativeAssetPath(reference, rawAssetPath);
  const candidate = await resolveContainedFile(vaultRoot, relativePath, "Learning-vault asset not found.");
  const info = await stat(candidate);
  if (info.size < 1 || info.size > MAX_VAULT_ASSET_BYTES) {
    throw new VaultDocumentError(413, "Learning-vault asset exceeds the 12 MiB viewer limit.");
  }
  const bytes = await readFile(candidate, { signal });
  const mimeType = detectAssetMime(bytes);
  const extension = extname(candidate).toLowerCase();
  if (!mimeType || !extensionMatchesMime(extension, mimeType)) {
    throw new VaultDocumentError(415, "Learning-vault asset content type is not supported.");
  }
  return { bytes, mimeType };
}
