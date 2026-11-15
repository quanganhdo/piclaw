/** Explicit-handle, retryable migration of existing text media to gzip.
 * No connection singleton, new ledger, or reinterpretation of legacy markers. */
import type { Database } from "bun:sqlite";
import { gunzipSync } from "bun";
import { isCompressible, compressMedia } from "./media-compression.js";

export interface RecompressResult {
  status: "complete" | "partial" | "failed";
  scanned: number;
  compressed: number;
  savedBytes: number;
  skipped: number;
  errors: number;
}
export type MediaCompressionOutcome = RecompressResult | { status: "already_complete" | "failed" };

export function recompressExistingMedia(db: Database): RecompressResult {
  return db.transaction(() => {
    const result: RecompressResult = { status: "complete", scanned: 0, compressed: 0, savedBytes: 0, skipped: 0, errors: 0 };
    const last = (db.prepare("SELECT MAX(id) AS last FROM media").get() as { last: number | null }).last;
    if (last === null) return result;
    if (!Number.isSafeInteger(last)) throw Error("Media migration identifier exceeds supported range.");
    // Stream only metadata, bounded by the initial high-water mark. Each row
    // is attempted once per pass; blobs are loaded individually, never in bulk.
    const rows = db.prepare("SELECT id, content_type, metadata FROM media WHERE id <= ? ORDER BY id")
      .iterate(last) as Iterable<{ id: number; content_type: string; metadata: string | null }>;
    const read = db.prepare("SELECT data, metadata FROM media WHERE id = ?");
    const update = db.prepare("UPDATE media SET data = ?, metadata = ? WHERE id = ?");
    const replace = db.transaction((id: number, data: Uint8Array, metadata: string) => {
      if (update.run(data, metadata, id).changes !== 1) throw Error("Media migration update not applied.");
      const stored = read.get(id) as { data: Uint8Array; metadata: string } | null;
      if (!stored || stored.metadata !== metadata || !Buffer.from(stored.data).equals(data))
        throw Error("Media migration update verification failed.");
    });
    for (const row of rows) {
      result.scanned++;
      if (!isCompressible(row.content_type)) { result.skipped++; continue; }
      try {
        if (!Number.isSafeInteger(row.id)) throw Error("Media migration identifier exceeds supported range.");
        let meta: Record<string, unknown> | null = null;
        if (row.metadata !== null && row.metadata !== "") {
          const parsed: unknown = JSON.parse(row.metadata);
          if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) throw Error("Invalid media metadata.");
          meta = parsed as Record<string, unknown> | null;
        }
        if (meta?.compressed === "gzip") { result.skipped++; continue; }
        if (meta?.compressed != null) throw Error("Unsupported media compression marker.");
        const blob = read.get(row.id) as { data: Uint8Array } | null;
        if (!blob || !(blob.data instanceof Uint8Array)) throw Error("Media migration payload unavailable.");
        const compressed = compressMedia(blob.data, row.content_type, meta);
        if (compressed.metadata?.compressed !== "gzip") { result.skipped++; continue; }
        if (!Buffer.from(gunzipSync(Buffer.from(compressed.data))).equals(blob.data))
          throw Error("Media compression round-trip failed.");
        // A savepoint restores original bytes/metadata even if an AFTER trigger
        // mutates the row or raises FAIL after the UPDATE has taken effect.
        replace(row.id, compressed.data, JSON.stringify(compressed.metadata));
        result.compressed++;
        result.savedBytes += blob.data.length - compressed.data.length;
      } catch {
        // RAISE(ROLLBACK) or a storage failure may invalidate the enclosing
        // transaction. Never continue and autocommit subsequent rows outside it.
        if (!db.inTransaction) throw Error("Media migration transaction was rolled back.");
        result.errors++;
      }
    }
    if (result.errors) result.status = result.compressed + result.skipped > 0 ? "partial" : "failed";
    return result;
  }).immediate();
}

/** Legacy v2 is authoritative, including older databases whose original pass
 * cannot now be proven. Never reset markers or automatically replay old work. */
export function migrateMediaCompression(db: Database): MediaCompressionOutcome {
  const outerTransaction = db.inTransaction;
  const version = () => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  try {
    if (version() >= 2) return { status: "already_complete" };
    return db.transaction((): MediaCompressionOutcome => {
      if (version() >= 2) return { status: "already_complete" };
      const result = recompressExistingMedia(db);
      if (result.status !== "complete") return result;
      db.exec("PRAGMA user_version = 2;");
      if (version() !== 2) throw Error("Media compression completion marker not applied.");
      return result;
    }).immediate();
  } catch {
    if (outerTransaction && !db.inTransaction) throw Error("Media migration invalidated the startup transaction.");
    return { status: "failed" };
  }
}
