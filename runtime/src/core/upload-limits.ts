/** Storage policy, independent of the configured per-file acceptance limit. */
export const DATABASE_ATTACHMENT_MAX_BYTES = 32 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
export const UPLOAD_CHUNK_TIMEOUT_MS = 120_000;

/** Portable leaf names that cannot split/deceive a line-oriented Files reference. */
export function isSafeUploadFilename(name: string): boolean {
  return Boolean(name && name === name.trim() && new TextEncoder().encode(name).length <= 220
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)
    && !Array.from(name).some(char => '/\\:*?"<>|'.includes(char))
    && name !== '.' && name !== '..' && !/[. ]$/.test(name)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name));
}
