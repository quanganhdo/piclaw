/**
 * Helpers for RFC 6266/RFC 5987 Content-Disposition headers.
 *
 * Browser-side `download` attributes are advisory, and iOS Safari is
 * particularly willing to ignore them for PDFs. Server responses that are meant
 * to download must therefore include an explicit disposition plus filename.
 */

function fallbackFilename(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "download";
  const basename = trimmed.split(/[\\/]/).pop()?.trim() || "download";
  const safe = basename
    // Intentionally sanitize ASCII control characters from HTTP filenames.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[\\/]/g, "_")
    .replace(/"/g, "_")
    .trim();
  return safe || "download";
}

function asciiFilename(value: string): string {
  const ascii = value.replace(/[^\x20-\x7e]/g, "_").replace(/[%;]/g, "_").trim();
  return ascii || "download";
}

function encode5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}

export function buildContentDisposition(disposition: "attachment" | "inline", filename: string | null | undefined): string {
  const safe = fallbackFilename(filename || "download");
  return `${disposition}; filename="${asciiFilename(safe)}"; filename*=UTF-8''${encode5987(safe)}`;
}
