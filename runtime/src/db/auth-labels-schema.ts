import type Database from 'bun:sqlite';

/** Add optional human labels without rewriting credentials, login IDs or bearer hashes. */
export function initializeAuthLabelsSchema(database: Database): void {
  database.transaction(() => {
    for (const table of ['web_sessions', 'webauthn_credentials']) {
      const columns = database.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(column => column.name === 'label')) database.exec(`ALTER TABLE ${table} ADD COLUMN label TEXT NOT NULL DEFAULT ''`);
    }
  }).immediate();
}
