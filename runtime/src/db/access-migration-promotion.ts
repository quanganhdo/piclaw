import type Database from 'bun:sqlite';
import { RESOURCE_MIGRATION_POLICY } from './access-resource-migration.js';
import { MIGRATION_INPUT_POLICY } from './migration-input-holds.js';

const FACTOR_PASSKEY_POLICY = 'preserve-immutable-handles';

type Preparation = {
  source_snapshot: string;
  plan_version: number;
  prepared_at: string;
  state: string;
  children_pending: number;
  children_adopted: number;
  resource_policy: string | null;
  factor_policy_json: string | null;
  input_policy: string | null;
};

function table(database: Database, name: string): boolean {
  return Boolean(database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function preparation(database: Database): Preparation {
  if (!table(database, 'access_migration_preparation')) throw new Error('Prepared migration marker is missing.');
  const columns = new Set((database.query('PRAGMA table_info(access_migration_preparation)').all() as {name:string}[]).map(row => row.name));
  for (const name of ['source_snapshot','plan_version','prepared_at','state','children_pending','children_adopted','resource_policy','factor_policy_json','input_policy']) {
    if (!columns.has(name)) throw new Error('Prepared copy predates the supported family release gate. Prepare a new version-five copy.');
  }
  const row = database.query(`SELECT source_snapshot,plan_version,prepared_at,state,children_pending,children_adopted,
    resource_policy,factor_policy_json,input_policy FROM access_migration_preparation WHERE id=1`).get() as Preparation | null;
  if (!row || !/^[0-9a-f]{64}$/.test(row.source_snapshot) || row.plan_version !== 5 || row.state !== 'ownership-only'
    || !Number.isSafeInteger(row.children_pending) || row.children_pending !== 0 || !Number.isSafeInteger(row.children_adopted) || row.children_adopted < 0
    || row.resource_policy !== RESOURCE_MIGRATION_POLICY || row.input_policy !== MIGRATION_INPUT_POLICY || !Number.isFinite(Date.parse(row.prepared_at))) {
    throw new Error('Prepared copy is not eligible for family promotion.');
  }
  let factorPolicy: unknown;
  try { factorPolicy = JSON.parse(row.factor_policy_json ?? ''); } catch { throw new Error('Prepared copy has invalid factor policy evidence.'); }
  if (!factorPolicy || typeof factorPolicy !== 'object' || Array.isArray(factorPolicy)
    || (factorPolicy as any).passkeys !== FACTOR_PASSKEY_POLICY || !['none','import-default'].includes((factorPolicy as any).legacy_totp)
    || Object.keys(factorPolicy as object).length !== 2) throw new Error('Prepared copy has invalid factor policy evidence.');
  return row;
}

function validateReceipts(database: Database, row: Preparation): void {
  if (!table(database, 'access_resource_migration') || !table(database, 'access_factor_migration') || !table(database, 'access_input_migration') || !table(database, 'migration_input_holds')) {
    throw new Error('Prepared copy lacks required migration evidence.');
  }
  const resource = database.query('SELECT policy,source_snapshot FROM access_resource_migration WHERE id=1').get() as {policy:string;source_snapshot:string}|null;
  const factor = database.query('SELECT source_snapshot,policy_json FROM access_factor_migration WHERE id=1').get() as {source_snapshot:string;policy_json:string}|null;
  const input = database.query('SELECT source_snapshot,policy,held_inputs FROM access_input_migration WHERE id=1').get() as {source_snapshot:string;policy:string;held_inputs:number}|null;
  if (!resource || resource.policy !== row.resource_policy || resource.source_snapshot !== row.source_snapshot
    || !factor || factor.source_snapshot !== row.source_snapshot || factor.policy_json !== row.factor_policy_json
    || !input || input.source_snapshot !== row.source_snapshot || input.policy !== row.input_policy || !Number.isSafeInteger(input.held_inputs) || input.held_inputs < 0
    || Number((database.query('SELECT count(*) n FROM migration_input_holds').get() as {n:number}).n) !== input.held_inputs) throw new Error('Prepared migration receipts do not match the reviewed snapshot.');
  if (database.query('SELECT 1 FROM migration_input_holds WHERE source_snapshot<>? LIMIT 1').get(row.source_snapshot)) {
    throw new Error('Legacy input hold evidence does not match the reviewed snapshot.');
  }
  const adopted = Number((database.query("SELECT count(*) n FROM owned_fork_operations WHERE seed_json LIKE '%\"mode\":\"adopted_jsonl\"%'").get() as {n:number}).n);
  if (adopted !== row.children_adopted) throw new Error('Prepared child adoption evidence changed.');
}

function validateOwnership(database: Database): void {
  if (database.query(`SELECT 1 FROM chat_branches b LEFT JOIN session_roots o ON o.root_branch_id=b.branch_id
    WHERE b.chat_jid=b.root_chat_jid AND b.parent_branch_id IS NULL AND (o.owner_user_id IS NULL OR o.policy<>'private') LIMIT 1`).get()) {
    throw new Error('Every root requires private ownership before family startup.');
  }
  if (database.query(`SELECT 1 FROM chat_branches b JOIN chat_branches r ON r.chat_jid=b.root_chat_jid
    JOIN session_roots o ON o.root_branch_id=r.branch_id WHERE b.handle_owner_id<>o.owner_user_id LIMIT 1`).get()) {
    throw new Error('Every branch handle must match its root owner before family startup.');
  }
  if (database.query(`SELECT 1 FROM users u LEFT JOIN chat_branches b ON b.chat_jid=u.home_chat_jid
    LEFT JOIN session_roots o ON o.root_branch_id=b.branch_id WHERE u.enabled=1 AND
    (u.home_chat_jid IS NULL OR b.parent_branch_id IS NOT NULL OR b.chat_jid<>b.root_chat_jid OR b.archived_at IS NOT NULL OR o.owner_user_id<>u.id) LIMIT 1`).get()) {
    throw new Error('Every enabled account requires an active owned home before family startup.');
  }
}

export function inspectPreparedFamilyDatabase(database: Database): {source_snapshot:string;plan_version:5;prepared_at:string;children_adopted:number} {
  const row = preparation(database);
  validateReceipts(database, row);
  validateOwnership(database);
  const state = database.query('SELECT activated_mode,schema_version FROM access_state WHERE id=1').get() as {activated_mode:string;schema_version:number}|null;
  if (!state || state.activated_mode !== 'single-user' || state.schema_version !== 1) throw new Error('Prepared copy activation state changed.');
  return {source_snapshot:row.source_snapshot,plan_version:5,prepared_at:row.prepared_at,children_adopted:row.children_adopted};
}

/** Mutate only a verified destination cloned from the prepared copy. */
export function promotePreparedFamilyDatabase(database: Database): {source_snapshot:string;promoted_at:string;children_adopted:number} {
  return database.transaction(() => {
    const row = preparation(database);
    inspectPreparedFamilyDatabase(database);
    const promotedAt = new Date().toISOString();
    database.exec(`CREATE TABLE access_migration_promotion (
      id INTEGER PRIMARY KEY CHECK(id=1), source_snapshot TEXT NOT NULL, plan_version INTEGER NOT NULL CHECK(plan_version=5),
      prepared_at TEXT NOT NULL, promoted_at TEXT NOT NULL, children_adopted INTEGER NOT NULL,
      resource_policy TEXT NOT NULL, factor_policy_json TEXT NOT NULL, input_policy TEXT NOT NULL
    ) STRICT;
    CREATE TRIGGER access_migration_promotion_update_immutable BEFORE UPDATE ON access_migration_promotion
      BEGIN SELECT RAISE(ABORT,'Access migration promotion is immutable'); END;
    CREATE TRIGGER access_migration_promotion_delete_immutable BEFORE DELETE ON access_migration_promotion
      BEGIN SELECT RAISE(ABORT,'Access migration promotion is immutable'); END;`);
    database.query('INSERT INTO access_migration_promotion VALUES (1,?,?,?,?,?,?,?,?)').run(
      row.source_snapshot,row.plan_version,row.prepared_at,promotedAt,row.children_adopted,row.resource_policy,row.factor_policy_json,row.input_policy,
    );
    database.query("UPDATE access_state SET activated_mode='family-shared' WHERE id=1 AND activated_mode='single-user'").run();
    database.exec('DROP TABLE access_migration_preparation;');
    return {source_snapshot:row.source_snapshot,promoted_at:promotedAt,children_adopted:row.children_adopted};
  }).immediate();
}

/** Normal family startup requires an immutable promotion receipt plus live ownership invariants. */
export function validatePromotedFamilyDatabase(database: Database): void {
  if (table(database, 'access_migration_preparation') || !table(database, 'access_migration_promotion')) throw new Error('Family database is not promoted by this release.');
  const row = database.query(`SELECT source_snapshot,plan_version,prepared_at,promoted_at,children_adopted,
    resource_policy,factor_policy_json,input_policy FROM access_migration_promotion WHERE id=1`).get() as any;
  if (!row || !/^[0-9a-f]{64}$/.test(row.source_snapshot) || row.plan_version !== 5 || !Number.isFinite(Date.parse(row.prepared_at))
    || !Number.isFinite(Date.parse(row.promoted_at)) || !Number.isSafeInteger(row.children_adopted) || row.children_adopted < 0
    || row.resource_policy !== RESOURCE_MIGRATION_POLICY || row.input_policy !== MIGRATION_INPUT_POLICY) throw new Error('Family promotion receipt is invalid.');
  let factorPolicy: any; try { factorPolicy=JSON.parse(row.factor_policy_json); } catch { throw new Error('Family promotion receipt is invalid.'); }
  if (factorPolicy?.passkeys !== FACTOR_PASSKEY_POLICY || !['none','import-default'].includes(factorPolicy?.legacy_totp)) throw new Error('Family promotion receipt is invalid.');
  validateReceipts(database, { ...row, state:'ownership-only', children_pending:0 });
  validateOwnership(database);
}
