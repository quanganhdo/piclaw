import { afterEach, beforeEach, expect, test } from 'bun:test';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { createUser, updateUser } from '../../src/db/users.js';
import { ensureChatBranch } from '../../src/db/chat-branches.js';
import { storeChatMetadata } from '../../src/db/messages.js';
import { provisionUserHome } from '../../src/db/session-ownership.js';
import { prepareAccessMigrationCopy, readAccessMigrationInventory } from '../../src/db/access-migration-plan.js';
import { inspectPreparedFamilyDatabase, promotePreparedFamilyDatabase, validatePromotedFamilyDatabase } from '../../src/db/access-migration-promotion.js';
import { RESOURCE_MIGRATION_POLICY } from '../../src/db/access-resource-migration.js';
import { MIGRATION_INPUT_POLICY } from '../../src/db/migration-input-holds.js';

function prepare() {
  const db=getDb();
  storeChatMetadata('web:default',new Date().toISOString(),'default');ensureChatBranch({chat_jid:'web:default',root_chat_jid:'web:default'});provisionUserHome(db,'default','web:default');
  const alice=createUser(db,{username:'alice',displayName:'Alice',role:'member'}).id;
  storeChatMetadata('web:alice',new Date().toISOString(),'alice');ensureChatBranch({chat_jid:'web:alice',root_chat_jid:'web:alice'});provisionUserHome(db,alice,'web:alice');updateUser(db,alice,{enabled:true});
  const inventory=readAccessMigrationInventory(db),plan={...inventory.plan,version:5 as const,child_sessions:[],resource_policy:RESOURCE_MIGRATION_POLICY,
    factor_policy:{passkeys:'preserve-immutable-handles' as const,legacy_totp:'none' as const},input_policy:MIGRATION_INPUT_POLICY};
  prepareAccessMigrationCopy(db,plan);return {db,alice,snapshot:inventory.snapshot};
}
beforeEach(()=>{closeDatabase();initDatabase();});afterEach(()=>closeDatabase());

test('version-five prepared copy promotes atomically and validates normal family startup receipt',()=>{
  const {db,snapshot}=prepare();const prepared=inspectPreparedFamilyDatabase(db);expect(prepared).toMatchObject({source_snapshot:snapshot,plan_version:5,children_adopted:0});
  const out=promotePreparedFamilyDatabase(db);expect(out.source_snapshot).toBe(snapshot);expect(()=>validatePromotedFamilyDatabase(db)).not.toThrow();
  expect(db.query('SELECT activated_mode FROM access_state').get()).toEqual({activated_mode:'family-shared'});expect(db.query("SELECT 1 FROM sqlite_master WHERE name='access_migration_preparation'").get()).toBeNull();
  expect(()=>promotePreparedFamilyDatabase(db)).toThrow();expect(()=>db.query("UPDATE access_migration_promotion SET source_snapshot='x'").run()).toThrow('immutable');
});

test('promotion rejects older marker shape pending children and mismatched receipts without partial activation',()=>{
  for(const mutate of [
    (db:any)=>db.query('UPDATE access_migration_preparation SET plan_version=4').run(),
    (db:any)=>db.query('UPDATE access_migration_preparation SET children_pending=1').run(),
    (db:any)=>db.query("UPDATE access_resource_migration SET source_snapshot='"+'0'.repeat(64)+"'").run(),
    (db:any)=>db.query("UPDATE access_factor_migration SET policy_json='{}'").run(),
  ]) {closeDatabase();initDatabase();const {db}=prepare();mutate(db);expect(()=>promotePreparedFamilyDatabase(db)).toThrow();expect(db.query('SELECT activated_mode FROM access_state').get()).toEqual({activated_mode:'single-user'});expect(db.query("SELECT 1 FROM sqlite_master WHERE name='access_migration_promotion'").get()).toBeNull();}
});

test('promoted family validation rejects ownership and receipt tampering',()=>{
  const {db,alice}=prepare();promotePreparedFamilyDatabase(db);db.query('UPDATE users SET home_chat_jid=NULL WHERE id=?').run(alice);expect(()=>validatePromotedFamilyDatabase(db)).toThrow('active owned home');
});
