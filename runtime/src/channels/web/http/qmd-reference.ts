const MAX_REFERENCE_LENGTH = 4_096;
const MAX_FROM_LINE = 10_000_000;
export const MAX_QMD_RANGE_LINES = 5_000;
const COLLECTION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DOC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;

export interface ParsedQmdReference {
  /** Canonical pane/link URI, including an optional line-range suffix. */
  uri: string;
  /** Value accepted by QMD's get tool, without a line-range suffix. */
  file: string;
  title: string;
  collection?: string;
  path?: string;
  docId?: string;
  fromLine?: number;
  maxLines?: number;
}

export class QmdReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QmdReferenceError";
  }
}

function parsePositiveInteger(raw: string | undefined, label: string, max: number): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new QmdReferenceError(`${label} must be a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new QmdReferenceError(`${label} must be between 1 and ${max}.`);
  }
  return value;
}

function splitLineRange(value: string): { base: string; fromLine?: number; maxLines?: number } {
  const match = value.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/);
  if (!match) throw new QmdReferenceError("Invalid QMD reference.");
  const base = match[1] ?? "";
  const fromLine = parsePositiveInteger(match[2], "fromLine", MAX_FROM_LINE);
  const maxLines = parsePositiveInteger(match[3], "maxLines", MAX_QMD_RANGE_LINES);
  if (maxLines !== undefined && fromLine === undefined) {
    throw new QmdReferenceError("maxLines requires fromLine.");
  }
  return { base, fromLine, maxLines };
}

function rangeSuffix(fromLine?: number, maxLines?: number): string {
  if (fromLine === undefined) return "";
  return maxLines === undefined ? `:${fromLine}` : `:${fromLine}:${maxLines}`;
}

function parseDocId(rawId: string): ParsedQmdReference {
  const { base, fromLine, maxLines } = splitLineRange(rawId);
  let decoded: string;
  try {
    decoded = decodeURIComponent(base).replace(/^#/, "");
  } catch {
    throw new QmdReferenceError("QMD document ID contains invalid percent encoding.");
  }
  if (!DOC_ID_RE.test(decoded)) throw new QmdReferenceError("Invalid QMD document ID.");
  const suffix = rangeSuffix(fromLine, maxLines);
  return {
    uri: `qmd://doc/%23${encodeURIComponent(decoded)}${suffix}`,
    file: `#${decoded}`,
    title: `#${decoded}`,
    docId: decoded,
    fromLine,
    maxLines,
  };
}

/** Parse the safe QMD references accepted by the web viewer. */
export function parseQmdReference(input: string): ParsedQmdReference {
  const raw = String(input || "").trim();
  if (!raw || raw.length > MAX_REFERENCE_LENGTH) throw new QmdReferenceError("Invalid QMD reference length.");

  const opaqueDocId = raw.match(/^qmd:#(.+)$/i);
  if (opaqueDocId) return parseDocId(opaqueDocId[1] ?? "");

  // Accept an encoded document ID in the authority for compatibility with URI emitters.
  const authorityDocId = raw.match(/^qmd:\/\/%23([^/?#]+)$/i);
  if (authorityDocId) return parseDocId(authorityDocId[1] ?? "");

  // WHATWG URL parsing normalizes dot segments. Reject them before parsing so
  // a traversal-shaped citation cannot silently resolve to a different file.
  const authorityEnd = raw.indexOf("/", raw.indexOf("://") + 3);
  if (authorityEnd >= 0) {
    const rawPath = raw.slice(authorityEnd + 1).split(/[?#]/, 1)[0] ?? "";
    try {
      if (decodeURIComponent(rawPath).split("/").some((segment) => segment === "." || segment === "..")) {
        throw new QmdReferenceError("QMD document paths cannot traverse collections.");
      }
    } catch (error) {
      if (error instanceof QmdReferenceError) throw error;
      throw new QmdReferenceError("QMD path contains invalid percent encoding.");
    }
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QmdReferenceError("Malformed QMD URL.");
  }
  if (url.protocol !== "qmd:") throw new QmdReferenceError("QMD references must use the qmd: scheme.");
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new QmdReferenceError("QMD references cannot contain credentials, ports, query parameters, or fragments.");
  }

  let collection: string;
  try {
    collection = decodeURIComponent(url.hostname);
  } catch {
    throw new QmdReferenceError("QMD collection contains invalid percent encoding.");
  }
  if (collection.toLowerCase() === "doc") {
    const encodedId = url.pathname.replace(/^\//, "");
    return parseDocId(encodedId);
  }
  if (!COLLECTION_RE.test(collection)) throw new QmdReferenceError("Invalid QMD collection name.");

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new QmdReferenceError("QMD path contains invalid percent encoding.");
  }
  const { base: path, fromLine, maxLines } = splitLineRange(decodedPath);
  if (!path || path.length > 2_048 || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new QmdReferenceError("Invalid QMD document path.");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new QmdReferenceError("QMD document paths cannot traverse collections.");
  }
  if (!path.toLowerCase().endsWith(".md")) throw new QmdReferenceError("QMD document paths must end in .md.");

  const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join("/");
  const file = `qmd://${collection}/${encodedPath}`;
  return {
    uri: `${file}${rangeSuffix(fromLine, maxLines)}`,
    file,
    title: segments.at(-1) ?? path,
    collection,
    path,
    fromLine,
    maxLines,
  };
}
