import type Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { previewAccessMigration, readAccessState } from './access-state.js';
import { assignLegacyRootOwners } from './session-ownership.js';
import { migrateOwnedSessionHandles } from './session-handles.js';
import { commitChildAdoptions, type ChildAdoptionInput, type ChildAdoptionSnapshot } from './access-child-adoption.js';
import { applyMigrationResourcePolicy, readMigrationResourceInventory, validateResourceMigration } from './access-resource-migration.js';
import { applyMigrationFactorPolicy, readMigrationFactorInventory, validateFactorMigration, type FactorMigrationPolicy } from './access-factor-migration.js';
import type { PreparedLegacyTotp } from '../secure/user-auth-factors.js';
import { captureMigrationInputHolds, MIGRATION_INPUT_POLICY } from './migration-input-holds.js';

export interface AccessMigrationPlan {
  version: 1 | 2 | 3 | 4 | 5;
  snapshot: string;
  assignments: { root_chat_jid: string; owner_user_id: string | null }[];
  child_sessions?: ChildAdoptionInput[];
  resource_policy?: string;
  factor_policy?: FactorMigrationPolicy;
  input_policy?: string;
}

/** Metadata only. Fingerprint covers every field used to validate ownership and handle adoption. */
export function readAccessMigrationInventory(database: Database) {
  return database.transaction(() => {
    const state = readAccessState(database);
    if (state.activatedMode !== 'single-user') throw new Error('Copy preparation requires a single-user source store.');
    const topology = previewAccessMigration(database);
    const users = database.query('SELECT id,username,role,enabled,home_chat_jid FROM users ORDER BY id').all() as {id:string;username:string;role:string;enabled:number;home_chat_jid:string|null}[];
    const branches = database.query('SELECT branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,handle_owner_id,archived_at FROM chat_branches ORDER BY branch_id').all() as {branch_id:string;chat_jid:string;root_chat_jid:string;parent_branch_id:string|null;agent_name:string;handle_owner_id:string;archived_at:string|null}[];
    const owners = database.query('SELECT root_branch_id,owner_user_id,policy FROM session_roots ORDER BY root_branch_id').all() as {root_branch_id:string;owner_user_id:string;policy:string}[];
    const schema = database.query('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
    const resources = readMigrationResourceInventory(database);
    const factors = readMigrationFactorInventory(database);
    const snapshot = createHash('sha256').update(JSON.stringify({state,topology,users,branches,owners,schema,resources,factors})).digest('hex');
    const assignments = topology.roots.map(root => {
      const branch = branches.find(branch => branch.chat_jid === root.chatJid)!;
      const existing = owners.find(owner => owner.root_branch_id === branch.branch_id);
      return {root_chat_jid:root.chatJid,owner_user_id:existing?.owner_user_id ?? null};
    });
    return { snapshot, users, branches, owners, topology, resources, factors, plan: {version:1,snapshot,assignments} as AccessMigrationPlan,
      warning:'Review and fill every owner ID explicitly. This prepares a non-startable copy only; no source writes, activation or child seed adoption.' };
  })();
}

function exact(value: unknown, keys: string[]): asserts value is Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid migration plan fields.');
}

export function validateAccessMigrationPlan(database: Database, input: unknown) {
  const version=(input as any)?.version;
  exact(input,version===5?['version','snapshot','assignments','child_sessions','resource_policy','factor_policy','input_policy']:version===4?['version','snapshot','assignments','child_sessions','resource_policy','factor_policy']:version===3?['version','snapshot','assignments','child_sessions','resource_policy']:version===2?['version','snapshot','assignments','child_sessions']:['version','snapshot','assignments']);
  if (![1,2,3,4,5].includes(version) || (version>=2&&!Array.isArray(input.child_sessions)) || typeof input.snapshot !== 'string' || !/^[0-9a-f]{64}$/.test(input.snapshot) || !Array.isArray(input.assignments)) throw new Error('Invalid migration plan.');
  const inventory = readAccessMigrationInventory(database);
  if (inventory.snapshot !== input.snapshot) throw new Error('Migration inventory changed. Create and review a fresh preview.');
  if(version>=3)validateResourceMigration(database,input.resource_policy);
  if(version>=4)validateFactorMigration(database,input.factor_policy);
  if(version===5&&input.input_policy!==MIGRATION_INPUT_POLICY)throw new Error('Explicit legacy input hold policy required.');
  if (inventory.topology.quarantined.length) throw new Error('Quarantined topology/non-web resources must be resolved before copy preparation.');
  const assignments = input.assignments.map(value => {
    exact(value,['root_chat_jid','owner_user_id']);
    if (typeof value.root_chat_jid !== 'string' || typeof value.owner_user_id !== 'string' || !value.owner_user_id) throw new Error('Every root needs an explicit owner ID.');
    return {rootChatJid:value.root_chat_jid,ownerUserId:value.owner_user_id};
  });
  const roots = new Map(inventory.topology.roots.map(root => [root.chatJid,root]));
  if (assignments.length !== roots.size || new Set(assignments.map(a=>a.rootChatJid)).size !== assignments.length) throw new Error('Map every root exactly once.');
  const owners = new Map(assignments.map(a=>[a.rootChatJid,a.ownerUserId]));
  for (const assignment of assignments) {
    if (!roots.has(assignment.rootChatJid) || !inventory.users.some(user=>user.id===assignment.ownerUserId)) throw new Error('Unknown root or owner.');
  }
  for (const existing of inventory.owners) {
    const branch = inventory.branches.find(branch=>branch.branch_id===existing.root_branch_id);
    if (!branch || branch.parent_branch_id || branch.chat_jid !== branch.root_chat_jid || existing.policy !== 'private' || owners.get(branch.chat_jid) !== existing.owner_user_id) throw new Error('Existing ownership cannot be transferred by migration.');
  }
  const names = new Set<string>();
  for (const branch of inventory.branches) {
    const owner = owners.get(branch.root_chat_jid);
    if (!owner || (branch.handle_owner_id && branch.handle_owner_id !== owner) || !/^[a-z0-9_-]{1,64}$/i.test(branch.agent_name)) throw new Error('Invalid handle or conflicting namespace.');
    const key = `${owner}\0${branch.agent_name.toLowerCase()}`;
    if (!branch.archived_at && names.has(key)) throw new Error('Owner-local handle collision. Rename explicitly before previewing again.');
    if (!branch.archived_at) names.add(key);
  }
  for (const user of inventory.users) {
    if (user.enabled && !user.home_chat_jid) throw new Error('Enabled account lacks a home.');
    if (user.home_chat_jid && (owners.get(user.home_chat_jid) !== user.id || roots.get(user.home_chat_jid)?.archived)) throw new Error('Existing account home must remain an active root owned by that account.');
  }
  return {inventory,assignments};
}

/** Apply ONLY to a newly verified destination copy; source and activation state are untouched. */
export function prepareAccessMigrationCopy(database: Database, plan: unknown, adoptions:ChildAdoptionSnapshot[]=[], legacyTotp?:PreparedLegacyTotp): {roots:number;branches:number;children_pending:number;children_adopted:number;snapshot:string} {
  return database.transaction(() => {
    const {inventory,assignments} = validateAccessMigrationPlan(database,plan);
    assignLegacyRootOwners(database,assignments);
    migrateOwnedSessionHandles(database);
    const requested=(plan as AccessMigrationPlan).child_sessions ?? [];
    if(requested.length!==adoptions.length||requested.some((row,index)=>row.chat_jid!==adoptions[index]?.chatJid||row.sha256!==adoptions[index]?.seed.sha256)) throw new Error('Child snapshots do not match the reviewed plan.');
    commitChildAdoptions(database,adoptions);
    if((plan as AccessMigrationPlan).version>=3)applyMigrationResourcePolicy(database,inventory.snapshot);
    if((plan as AccessMigrationPlan).version>=4)applyMigrationFactorPolicy(database,(plan as AccessMigrationPlan).factor_policy,inventory.snapshot,legacyTotp);
    else if(legacyTotp)throw new Error('Legacy factor requires a version-four plan.');
    if((plan as AccessMigrationPlan).version===5)captureMigrationInputHolds(database,inventory.snapshot,(plan as AccessMigrationPlan).input_policy);
    // A separate preparation marker blocks startup even though activation remains single-user.
    database.exec(`CREATE TABLE access_migration_preparation (
      id INTEGER PRIMARY KEY CHECK(id=1), source_snapshot TEXT NOT NULL,
      prepared_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state='ownership-only')
    ) STRICT;`);
    database.query("INSERT INTO access_migration_preparation VALUES (1,?,?,'ownership-only')").run(inventory.snapshot,new Date().toISOString());
    return {roots:assignments.length,branches:inventory.branches.length,children_pending:inventory.branches.filter(branch=>branch.parent_branch_id).length-adoptions.length,children_adopted:adoptions.length,snapshot:inventory.snapshot};
  }).immediate();
}
