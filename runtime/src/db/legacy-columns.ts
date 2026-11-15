import type { Database } from "bun:sqlite";

interface LegacyColumn {
  name: string;
  type: "TEXT" | "INTEGER";
  notNull?: boolean;
  defaultSql?: "0" | "''";
}
interface ColumnInfo {
  name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number;
}
const defaultValue = (value: string | null) => {
  let text = value?.trim() ?? null;
  while (text?.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1).trim();
  return text;
};

/** Compatibility bridge for selected pre-ledger core columns. New stable
 * schema changes belong in the existing owned migration ledger. */
export function ensureLegacyColumns(database: Database, table: "messages" | "keychain_entries" | "web_sessions", columns: readonly LegacyColumn[]): void {
  const inspect = (): ColumnInfo[] => {
    try { return database.prepare(`PRAGMA table_xinfo(${table})`).all() as ColumnInfo[]; }
    catch { throw Error(`Cannot inspect legacy schema postconditions: ${table}.`); }
  };
  let current = inspect();
  for (const column of columns) {
    if (!/^[a-z_]+$/.test(column.name)) throw Error("Invalid legacy column identifier.");
    let found = current.find(row => row.name === column.name);
    if (!found) {
      try {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.type}${column.notNull ? " NOT NULL" : ""}${column.defaultSql === undefined ? "" : ` DEFAULT ${column.defaultSql}`}`);
      } catch {
        // Re-read immediately: absence is an actual failure; an existing
        // concurrent column must still pass the full shape check below.
        current = inspect();
        found = current.find(row => row.name === column.name);
        if (!found) throw Error(`Legacy schema postcondition failed: ${table}.${column.name}.`);
      }
      if (!found) {
        current = inspect();
        found = current.find(row => row.name === column.name);
      }
    }
    if (!found || found.type.toUpperCase() !== column.type || found.notnull !== Number(Boolean(column.notNull)) ||
      defaultValue(found.dflt_value) !== (column.defaultSql ?? null) || found.pk !== 0 || found.hidden !== 0)
      throw Error(`Legacy schema postcondition failed: ${table}.${column.name}.`);
  }
}
