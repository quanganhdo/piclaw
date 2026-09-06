import type Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { setScheduledTaskAuthorityStatus } from './scheduled-task-authority.js';

export const RESOURCE_MIGRATION_POLICY = 'revoke-logins-pause-tasks-quarantine-media-v1';
const AUTH_TABLES = ['web_sessions','user_totp_registrations','user_totp_enrolments','user_auth_invitations','user_passkey_registrations','webauthn_enrollments'] as const;
const count = (db:Database,sql:string) => (db.query(sql).get() as {n:number}).n;

/** Hash relation/state metadata without exporting messages, payloads, tokens, URLs or keys. */
export function readMigrationResourceInventory(db:Database) {
  const hash=createHash('sha256');
  const queries=[
    'SELECT rowid,id,chat_jid,thread_id,timestamp,is_bot_message FROM messages ORDER BY rowid',
    'SELECT id FROM media ORDER BY id',
    'SELECT message_rowid,media_id FROM message_media ORDER BY message_rowid,media_id',
    'SELECT id,chat_jid,status,revision,next_run,task_kind FROM scheduled_tasks ORDER BY id',
    'SELECT task_id,current_revision,status,next_run_at FROM service_effect_s07_tasks ORDER BY task_id',
    'SELECT chat_jid,cursor_ts,preflight_message_id,inflight_message_id,failed_message_id,queued_followups_json,compaction_active_started_at FROM chat_cursors ORDER BY chat_jid',
    'SELECT session_id,user_id,expires_at FROM web_sessions ORDER BY session_id',
    'SELECT user_id,expires_at FROM user_auth_invitations ORDER BY user_id',
    'SELECT user_id,expires_at FROM user_totp_enrolments ORDER BY user_id',
    'SELECT user_id,expires_at FROM user_totp_registrations ORDER BY user_id',
    'SELECT user_id,expires_at FROM user_passkey_registrations ORDER BY user_id,expires_at',
    'SELECT user_id,expires_at FROM webauthn_enrollments ORDER BY user_id,expires_at',
  ];
  for(const sql of queries){hash.update(sql);for(const row of db.query(sql).iterate())hash.update(JSON.stringify(row));}
  const unresolved:Record<string,number>={
    chat_runs:count(db,`SELECT count(*) n FROM chat_cursors WHERE preflight_message_id IS NOT NULL OR preflight_started_at IS NOT NULL
      OR inflight_message_id IS NOT NULL OR inflight_started_at IS NOT NULL OR compaction_active_started_at IS NOT NULL
      OR (queued_followups_json IS NOT NULL AND trim(queued_followups_json) NOT IN ('','[]'))`),
    unregistered_messages:count(db,'SELECT count(*) n FROM messages m WHERE NOT EXISTS(SELECT 1 FROM chat_branches b WHERE b.chat_jid=m.chat_jid)'),
    foreign_thread_links:count(db,'SELECT count(*) n FROM messages m WHERE m.thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages t WHERE t.rowid=m.thread_id AND t.chat_jid=m.chat_jid)'),
    task_heads:count(db,`SELECT count(*) n FROM scheduled_tasks t LEFT JOIN service_effect_s07_tasks h ON h.task_id=t.id
      WHERE h.task_id IS NULL OR h.current_revision<>t.revision OR h.status<>t.status OR t.status NOT IN ('active','paused','completed')`),
    orphan_task_heads:count(db,"SELECT count(*) n FROM service_effect_s07_tasks h WHERE h.status<>'deleted' AND NOT EXISTS(SELECT 1 FROM scheduled_tasks t WHERE t.id=h.task_id)"),
  };
  // Some service-effect tables are installed only with their active composition. Count all unfinished records when present.
  const present=new Set((db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(row=>row.name));
  const durable=[
    ['service_effect_s07_occurrences',"state NOT IN ('completed','abandoned')"],
    ['service_effect_s05_outbox',"state NOT IN ('completed','failed','cancelled') OR retry_at IS NOT NULL"],
    ['service_effect_s01_sources',"state NOT IN ('consumed','disposed')"],
    ['service_effect_s01_queued_inputs',"state NOT IN ('consumed','disposed')"],
    ['service_effect_s01_operations',"phase<>'terminal'"],
    ['service_effect_s01_chats','active_operation_id IS NOT NULL'],
    ['service_effect_s01_wake_intents','1=1'],
  ];
  for(const [table,where] of durable) {
    unresolved[table!]=present.has(table!)?count(db,`SELECT count(*) n FROM ${table} WHERE ${where}`):0;
    hash.update(table!+':'+unresolved[table!]);
  }
  const auth=Object.fromEntries(AUTH_TABLES.map(table=>[table,count(db,`SELECT count(*) n FROM ${table}`)]));
  return {fingerprint:hash.digest('hex'),auth,active_tasks:count(db,"SELECT count(*) n FROM scheduled_tasks WHERE status='active'"),
    unconsumed_user_messages:count(db,`SELECT count(*) n FROM messages m LEFT JOIN chat_cursors c ON c.chat_jid=m.chat_jid
      WHERE coalesce(m.is_bot_message,0)=0 AND coalesce(m.timestamp,'')>coalesce(c.cursor_ts,'')`),
    media:count(db,'SELECT count(*) n FROM media'),unlinked_media:count(db,'SELECT count(*) n FROM media a WHERE NOT EXISTS(SELECT 1 FROM message_media mm WHERE mm.media_id=a.id)'),unresolved,
    excluded:['confirmed factors and legacy handles','shared keychain/provider credentials','filesystem push subscriptions and recordings','add-on state','unlinked tool outputs and thinking content']};
}

export function validateResourceMigration(db:Database,policy:unknown):void {
  if(policy!==RESOURCE_MIGRATION_POLICY)throw new Error('Explicit supported resource disposition policy required.');
  const report=readMigrationResourceInventory(db);
  if(Object.values(report.unresolved).some(n=>n>0))throw new Error('Unresolved execution, thread or task authority state blocks resource migration.');
}

/** Operates only within the prepared-copy transaction after root ownership is assigned. */
export function applyMigrationResourcePolicy(db:Database,snapshot:string) {
  validateResourceMigration(db,RESOURCE_MIGRATION_POLICY);
  const before=readMigrationResourceInventory(db),now=new Date().toISOString();
  for(const table of AUTH_TABLES)db.exec(`DELETE FROM ${table}`);
  const tasks=db.query("SELECT id FROM scheduled_tasks WHERE status='active' ORDER BY id").all() as {id:string}[];
  for(const task of tasks){setScheduledTaskAuthorityStatus(db,task.id,'paused',now);db.query("UPDATE scheduled_tasks SET status='paused' WHERE id=?").run(task.id);}
  db.exec(`CREATE TABLE migration_media_quarantine (
    media_id INTEGER PRIMARY KEY REFERENCES media(id), reason TEXT NOT NULL CHECK(reason IN ('unlinked','unresolved-link','multiple-owners')), created_at TEXT NOT NULL
  ) STRICT;`);
  db.query(`INSERT INTO migration_media_quarantine(media_id,reason,created_at)
    SELECT a.id, CASE WHEN count(mm.media_id)=0 THEN 'unlinked'
      WHEN count(mm.media_id)<>count(o.owner_user_id) THEN 'unresolved-link' ELSE 'multiple-owners' END, ?
    FROM media a LEFT JOIN message_media mm ON mm.media_id=a.id LEFT JOIN messages m ON m.rowid=mm.message_rowid
    LEFT JOIN chat_branches b ON b.chat_jid=m.chat_jid LEFT JOIN chat_branches r ON r.chat_jid=b.root_chat_jid
    LEFT JOIN session_roots o ON o.root_branch_id=r.branch_id GROUP BY a.id
    HAVING count(mm.media_id)=0 OR count(mm.media_id)<>count(o.owner_user_id) OR count(DISTINCT o.owner_user_id)>1`).run(now);
  const quarantined=count(db,'SELECT count(*) n FROM migration_media_quarantine');
  db.exec(`CREATE TABLE access_resource_migration (
    id INTEGER PRIMARY KEY CHECK(id=1),policy TEXT NOT NULL,source_snapshot TEXT NOT NULL,report_json TEXT NOT NULL,prepared_at TEXT NOT NULL
  ) STRICT;`);
  const report={revoked:before.auth,paused_tasks:tasks.length,quarantined_media:quarantined,excluded:before.excluded};
  db.query('INSERT INTO access_resource_migration VALUES (1,?,?,?,?)').run(RESOURCE_MIGRATION_POLICY,snapshot,JSON.stringify(report),now);
  return report;
}
