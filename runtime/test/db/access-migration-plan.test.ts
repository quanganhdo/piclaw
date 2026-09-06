import {beforeEach,afterEach,expect,test} from 'bun:test';
import '../helpers.js';
import {getDb,initDatabase,closeDatabase} from '../../src/db/connection.js';
import {createUser} from '../../src/db/users.js';
import {readAccessState,validateAccessStartup} from '../../src/db/access-state.js';
import {readAccessMigrationInventory,validateAccessMigrationPlan,prepareAccessMigrationCopy} from '../../src/db/access-migration-plan.js';

let bob:string;
function branch(jid:string,name:string,parent:string|null=null,root=jid,archived:string|null=null){const db=getDb();db.query("INSERT INTO chats(jid,name,last_message_time) VALUES (?,?,'now')").run(jid,name);db.query("INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at,archived_at) VALUES (?,?,?,?,?,'now','now',?)").run(jid,jid,root,parent,name,archived);}
beforeEach(()=>{closeDatabase();initDatabase();bob=createUser(getDb(),{username:'bob',displayName:'Bob'}).id;branch('web:default','main');branch('web:bob','bob');branch('web:child','child','web:default','web:default');branch('web:archive','archive',null,'web:archive','old');});
afterEach(()=>closeDatabase());
function plan(){const value=readAccessMigrationInventory(getDb()).plan;for(const a of value.assignments)a.owner_user_id=a.root_chat_jid==='web:bob'?bob:'default';return value;}

test('preview is deterministic, metadata-only and never auto-selects an unowned default',()=>{
  const db=getDb(),before=db.query('SELECT total_changes() n').get();
  const a=readAccessMigrationInventory(db),b=readAccessMigrationInventory(db);expect(a).toEqual(b);expect(a.plan.assignments.every(a=>a.owner_user_id===null)).toBe(true);expect(a.branches).toHaveLength(4);expect(a.topology.resources.messages).toBe(0);expect(db.query('SELECT total_changes() n').get()).toEqual(before);
});
test('explicit complete assignments preserve JIDs/names/archive, atomically adopt namespaces and block all startup modes',()=>{
  const db=getDb(),p=plan(),before=db.query('SELECT branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,archived_at FROM chat_branches ORDER BY branch_id').all();
  const result=prepareAccessMigrationCopy(db,p);expect(result).toMatchObject({roots:3,branches:4,children_pending:1});
  expect(db.query('SELECT branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,archived_at FROM chat_branches ORDER BY branch_id').all()).toEqual(before);
  expect(db.query("SELECT handle_owner_id FROM chat_branches WHERE chat_jid='web:child'").get()).toEqual({handle_owner_id:'default'});
  expect(db.query("SELECT owner_user_id FROM session_roots WHERE root_branch_id='web:bob'").get()).toEqual({owner_user_id:bob});
  expect(db.query('SELECT activated_mode FROM access_state').get()).toEqual({activated_mode:'single-user'});expect(()=>readAccessState(db)).toThrow('Prepared migration copy');expect(()=>validateAccessStartup(db)).toThrow('Prepared migration copy');expect(()=>prepareAccessMigrationCopy(db,p)).toThrow();
});
test('stale/incomplete/extra mappings, wrong home and collisions fail without partial ownership',()=>{
  const db=getDb(),p=plan();
  for(const invalid of [{...p,extra:1},{...p,assignments:p.assignments.slice(1)},{...p,assignments:[...p.assignments,p.assignments[0]]},{...p,assignments:p.assignments.map(a=>({...a,owner_user_id:null}))},{...p,assignments:p.assignments.map(a=>({...a,owner_user_id:'missing'}))},{...p,assignments:p.assignments.map(a=>({...a,owner_user_id:bob}))}])expect(()=>validateAccessMigrationPlan(db,invalid)).toThrow();
  db.query("UPDATE chat_branches SET agent_name='renamed' WHERE chat_jid='web:child'").run();expect(()=>prepareAccessMigrationCopy(db,p)).toThrow('changed');
  db.query("UPDATE chat_branches SET agent_name='MAIN' WHERE chat_jid='web:child'").run();expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('collision');expect(db.query('SELECT * FROM session_roots').all()).toEqual([]);
});
test('non-web roots, orphan/cycle/unregistered chats are quarantined; SQL failures roll back all namespace writes',()=>{
  const db=getDb();branch('external:root','external');expect(readAccessMigrationInventory(db).topology.quarantined).toHaveLength(1);expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('Quarantined');db.exec("DELETE FROM chat_branches WHERE chat_jid='external:root'; DELETE FROM chats WHERE jid='external:root';");
  db.query("UPDATE chat_branches SET parent_branch_id='missing' WHERE chat_jid='web:child'").run();expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('Quarantined');db.query("UPDATE chat_branches SET parent_branch_id='web:default' WHERE chat_jid='web:child'").run();
  db.exec("CREATE TRIGGER reject_copy BEFORE UPDATE OF handle_owner_id ON chat_branches WHEN OLD.chat_jid='web:child' BEGIN SELECT RAISE(ABORT,'fail copy'); END;");
  expect(()=>prepareAccessMigrationCopy(db,plan())).toThrow('fail copy');expect(db.query('SELECT * FROM session_roots').all()).toEqual([]);expect(db.query("SELECT count(*) n FROM chat_branches WHERE handle_owner_id<>''").get()).toEqual({n:0});expect(readAccessState(db).activatedMode).toBe('single-user');
});
