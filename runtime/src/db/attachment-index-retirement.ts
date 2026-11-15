import type { Database } from "bun:sqlite";
import { applyOwnedMigrations } from "./migrations.js";

export const attachmentIndexRetirement = Object.freeze({
  owner: "host.core-indexes", id: "retire-attachment-rowid-v1", order: 1,
  sql: "DROP INDEX IF EXISTS main.idx_message_media_message_rowid",
});

interface IndexInfo { name: string; unique: number; origin: string; partial: number }
interface IndexColumn { name: string | null; desc: number; coll: string | null; key: number }
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

function hasKeys(database: Database, index: IndexInfo, columns: readonly string[]): boolean {
  const keys = (database.query(`PRAGMA main.index_xinfo(${quote(index.name)})`).all() as IndexColumn[])
    .filter(column => column.key === 1);
  return keys.length === columns.length && keys.every((column, i) =>
    column.name?.toLowerCase() === columns[i] && column.desc === 0 && column.coll?.toUpperCase() === "BINARY");
}

/** One core owner retires only the verified historical non-unique index.
 * The primary-key autoindex is the covering attachment lookup/order path. */
export function retireAttachmentRowidIndex(database: Database): void {
  database.transaction(() => {
    if (database.query("SELECT 1 FROM sqlite_temp_schema WHERE name='piclaw_schema_migrations' COLLATE NOCASE").get()) {
      throw Error("Unsupported attachment migration ledger shadow");
    }
    const indexes = database.query("PRAGMA main.index_list(message_media)").all() as IndexInfo[];
    const primary = indexes.find(index => index.origin === "pk");
    if (!primary || primary.unique !== 1 || primary.partial !== 0 ||
        !hasKeys(database, primary, ["message_rowid", "media_id"])) {
      throw Error("Unsupported attachment primary-key replacement index");
    }
    const named = database.query("SELECT type,tbl_name FROM main.sqlite_schema WHERE name=? COLLATE NOCASE")
      .get("idx_message_media_message_rowid") as { type: string; tbl_name: string } | null;
    if (named) {
      const old = indexes.find(index => index.name.toLowerCase() === "idx_message_media_message_rowid");
      if (named.type !== "index" || named.tbl_name.toLowerCase() !== "message_media" || !old ||
          old.unique !== 0 || old.partial !== 0 || old.origin !== "c" || !hasKeys(database, old, ["message_rowid"])) {
        throw Error("Unsupported historical attachment rowid index");
      }
    }
    applyOwnedMigrations(database, [attachmentIndexRetirement]);
    // An older binary may recreate this exact non-unique index after rollback.
    // Enforce the same declared retirement without rewriting its original receipt.
    database.exec(attachmentIndexRetirement.sql);
  }).immediate();
}
