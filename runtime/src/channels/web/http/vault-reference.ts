const MAX_REFERENCE_LENGTH = 4_096;
const VAULT_URI_PREFIX = "obsidian:////workspace/vaults/learning/";
const VAULT_PATH_PREFIX = "//workspace/vaults/learning/";

export interface ParsedVaultReference {
  /** Canonical Obsidian URI, including an optional heading fragment. */
  uri: string;
  /** Vault-relative Markdown path, always ending in .md. */
  path: string;
  title: string;
  heading?: string;
}

export class VaultReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultReferenceError";
  }
}

function encodePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Parse the only Obsidian references exposed by the learning-vault viewer. */
export function parseVaultReference(input: string): ParsedVaultReference {
  const raw = String(input || "").trim();
  if (!raw || raw.length > MAX_REFERENCE_LENGTH) throw new VaultReferenceError("Invalid learning-vault reference length.");
  if (!raw.toLowerCase().startsWith(VAULT_URI_PREFIX)) {
    throw new VaultReferenceError("Learning-vault references must use the canonical Obsidian workspace path.");
  }

  // Reject traversal before WHATWG URL normalization can erase dot segments.
  const rawWithoutFragment = raw.split("#", 1)[0] ?? "";
  const rawPath = rawWithoutFragment.slice(VAULT_URI_PREFIX.length);
  if (/%(?:2f|5c)/i.test(rawPath)) throw new VaultReferenceError("Learning-vault path contains an encoded separator.");
  try {
    if (decodeURIComponent(rawPath).split("/").some((segment) => segment === "." || segment === "..")) {
      throw new VaultReferenceError("Learning-vault paths cannot traverse the vault.");
    }
  } catch (error) {
    if (error instanceof VaultReferenceError) throw error;
    throw new VaultReferenceError("Learning-vault path contains invalid percent encoding.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new VaultReferenceError("Malformed learning-vault URL.");
  }
  if (url.protocol !== "obsidian:" || url.username || url.password || url.host || url.port || url.search) {
    throw new VaultReferenceError("Invalid learning-vault URL components.");
  }
  if (!url.pathname.startsWith(VAULT_PATH_PREFIX)) {
    throw new VaultReferenceError("Learning-vault reference is outside the configured vault.");
  }

  let path: string;
  let heading: string | undefined;
  try {
    path = decodeURIComponent(url.pathname.slice(VAULT_PATH_PREFIX.length));
    heading = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined;
  } catch {
    throw new VaultReferenceError("Learning-vault reference contains invalid percent encoding.");
  }
  if (!path || path.length > 2_048 || path.includes("\\") || containsControlCharacter(path)) {
    throw new VaultReferenceError("Invalid learning-vault note path.");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new VaultReferenceError("Learning-vault paths cannot traverse the vault.");
  }
  if (!path.toLowerCase().endsWith(".md")) path += ".md";
  if (heading !== undefined && (!heading || heading.length > 512 || containsControlCharacter(heading))) {
    throw new VaultReferenceError("Invalid learning-vault heading.");
  }

  const canonical = `${VAULT_URI_PREFIX}${encodePath(path.replace(/\.md$/i, ""))}${heading ? `#${encodeURIComponent(heading)}` : ""}`;
  return {
    uri: canonical,
    path,
    title: path.split("/").at(-1)?.replace(/\.md$/i, "") || "Learning note",
    heading,
  };
}
