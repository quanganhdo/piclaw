import type Database from 'bun:sqlite';
import { createHash } from 'node:crypto';

export const MIGRATION_INPUT_POLICY = 'hold-legacy-inputs-owner-dismiss-v1';
export const migrationInputHash = (content:string) => createHash('sha256').update(content).digest('hex');

/** Copy-time only: never invent a login/actor for an old unconsumed input. */
export function captureMigrationInputHolds(db:Database,snapshot:string,policy:unknown):number {
  if(policy!==MIGRATION_INPUT_POLICY)throw new Error('Explicit legacy input hold policy required.');
  const rows=db.query(`SELECT m.rowid,m.id,m.chat_jid,m.timestamp,m.content,o.owner_user_id
    FROM messages m LEFT JOIN chat_cursors c ON c.chat_jid=m.chat_jid
    JOIN chat_branches b ON b.chat_jid=m.chat_jid JOIN chat_branches r ON r.chat_jid=b.root_chat_jid
    JOIN session_roots o ON o.root_branch_id=r.branch_id
    WHERE coalesce(m.is_bot_message,0)=0 AND coalesce(m.timestamp,'')>coalesce(c.cursor_ts,'') ORDER BY m.timestamp,m.rowid`).all() as {rowid:number;id:string;chat_jid:string;timestamp:string;content:string;owner_user_id:string}[];
  for(const row of rows) {
    if(typeof row.id!=='string'||!row.id||typeof row.content!=='string'||!Number.isFinite(Date.parse(row.timestamp)))throw new Error('Malformed legacy input cannot be held safely.');
    // Mixed already-admitted authority needs separate reconciliation, never silent reassignment.
    if(db.query('SELECT 1 FROM message_execution_authorities WHERE message_rowid=?').get(row.rowid))throw new Error('Existing execution authority requires separate reconciliation.');
    db.query('INSERT INTO migration_input_holds VALUES (?,?,?,?,?,?,?,?)').run(row.rowid,row.id,row.chat_jid,row.owner_user_id,row.timestamp,migrationInputHash(row.content),snapshot,new Date().toISOString());
  }
  return rows.length;
}

/** Row-specific filtering avoids timestamp-cursor skips when legacy timestamps collide. */
export function migrationDismissalFilter(db:Database,alias='messages'):string {
  if(!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='migration_input_holds'").get())return '';
  return `AND NOT EXISTS (SELECT 1 FROM migration_input_holds h JOIN migration_input_dismissals d ON d.message_rowid=h.message_rowid
    WHERE h.message_rowid=${alias}.rowid AND h.message_id=${alias}.id AND h.chat_jid=${alias}.chat_jid AND h.message_timestamp=${alias}.timestamp AND d.owner_user_id=h.owner_user_id)`;
}
