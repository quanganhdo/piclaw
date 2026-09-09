import type Database from 'bun:sqlite';

/** Add nullable legacy-compatible scope columns and enforce complete immutable family ownership. */
export function initializeToolOutputOwnership(database:Database):void {
  const columns=new Set((database.query('PRAGMA table_info(tool_outputs)').all() as {name:string}[]).map(row=>row.name));
  for(const [name,type] of [['owner_user_id','TEXT'],['root_branch_id','TEXT'],['source_branch_id','TEXT'],['chat_jid','TEXT'],['execution_kind','TEXT']] as const)if(!columns.has(name))database.exec(`ALTER TABLE tool_outputs ADD COLUMN ${name} ${type}`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_tool_outputs_owner_created ON tool_outputs(owner_user_id,created_at);
  CREATE TRIGGER IF NOT EXISTS tool_output_scope_complete BEFORE INSERT ON tool_outputs
    WHEN (NEW.owner_user_id IS NULL OR NEW.root_branch_id IS NULL OR NEW.source_branch_id IS NULL OR NEW.chat_jid IS NULL OR NEW.execution_kind IS NULL)
      AND NOT (NEW.owner_user_id IS NULL AND NEW.root_branch_id IS NULL AND NEW.source_branch_id IS NULL AND NEW.chat_jid IS NULL AND NEW.execution_kind IS NULL)
    BEGIN SELECT RAISE(ABORT,'Tool output scope must be complete'); END;
  CREATE TRIGGER IF NOT EXISTS tool_output_scope_valid BEFORE INSERT ON tool_outputs WHEN NEW.owner_user_id IS NOT NULL
    AND (NEW.execution_kind NOT IN ('interactive','scheduled','followup','side-prompt','dream','delegate') OR NOT EXISTS (
      SELECT 1 FROM session_roots o JOIN chat_branches r ON r.branch_id=o.root_branch_id
      JOIN chat_branches b ON b.branch_id=NEW.source_branch_id AND b.chat_jid=NEW.chat_jid AND b.root_chat_jid=r.chat_jid
      JOIN users u ON u.id=o.owner_user_id
      WHERE o.root_branch_id=NEW.root_branch_id AND o.owner_user_id=NEW.owner_user_id AND o.policy='private' AND u.enabled=1
    )) BEGIN SELECT RAISE(ABORT,'Invalid tool output ownership'); END;
  CREATE TRIGGER IF NOT EXISTS tool_output_scope_immutable BEFORE UPDATE OF owner_user_id,root_branch_id,source_branch_id,chat_jid,execution_kind ON tool_outputs
    WHEN NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.root_branch_id IS NOT OLD.root_branch_id
      OR NEW.source_branch_id IS NOT OLD.source_branch_id OR NEW.chat_jid IS NOT OLD.chat_jid OR NEW.execution_kind IS NOT OLD.execution_kind
    BEGIN SELECT RAISE(ABORT,'Tool output ownership is immutable'); END;`);
}
