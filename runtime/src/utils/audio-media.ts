/** Audio metadata policy shared by ingestion, serving and both preview skins.
 * This allowlist identifies containers, not decoder support or verified file bytes.
 * Explicit non-audio MIME types are never promoted by a filename.
 */
const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/x-mp3": "audio/mpeg",
  "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4",
  "audio/aac": "audio/aac", "audio/x-aac": "audio/aac",
  "audio/flac": "audio/flac", "audio/x-flac": "audio/flac",
  "audio/ogg": "audio/ogg", "audio/opus": "audio/ogg", "audio/webm": "audio/webm",
  "audio/wav": "audio/wav", "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav", "audio/vnd.wave": "audio/wav",
};
const AUDIO_EXTENSIONS: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  oga: "audio/ogg", ogg: "audio/ogg", opus: "audio/ogg", weba: "audio/webm", wav: "audio/wav",
};

export function resolveAudioContentType(contentType?: string | null, filename?: string | null): string | null {
  const raw = String(contentType || "");
  if (["\r", "\n", "\0"].some(character => raw.includes(character))) return null;
  const type = raw.split(";", 1)[0].trim().toLowerCase();
  if (Object.hasOwn(AUDIO_TYPES, type)) return AUDIO_TYPES[type];
  if (type && type !== "application/octet-stream") return null;
  const extension = String(filename || "").trim().toLowerCase().match(/\.([^.]+)$/)?.[1] || "";
  return Object.hasOwn(AUDIO_EXTENSIONS, extension) ? AUDIO_EXTENSIONS[extension] : null;
}
