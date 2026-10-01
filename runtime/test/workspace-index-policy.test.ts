import './helpers.js';
import {test, expect} from 'bun:test';
import {mkdirSync,writeFileSync,symlinkSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {withTempWorkspaceEnv} from './helpers.js';
import {validateWorkspaceIndexPolicy,workspaceIndexPathDecision,saveWorkspaceIndexPolicy,getWorkspaceIndexPolicy,workspaceIndexPolicySnapshot,workspaceIndexPolicyRoots} from '../src/core/workspace-index-policy.js';
import {initDatabase,closeDatabase,getDb} from '../src/db/connection.js';
import {refreshWorkspaceIndex} from '../src/workspace-index-core.js';
import {searchWorkspace} from '../src/workspace-search.js';

test('index policy globs, comments and literal roots are bounded and deterministic',()=>{
 const p=validateWorkspaceIndexPolicy({roots:['notes/','.pi/skills','projects/docs'],ignorePatterns:['# local rules','**/archive/**','notes/*/draft?.md','**/*.log']});
 expect(p.roots).toEqual(['notes','.pi/skills','projects/docs']);
 for(const name of ['notes/ok.md','.pi/skills/read/SKILL.md','projects/docs/readme.md'])expect(workspaceIndexPathDecision(name,p).included).toBe(true);
 for(const name of ['notes/archive','notes/archive/a.md','notes/a/archive/b.md','notes/a/draft1.md','notes/a.log','notes/family/a.md','.piclaw/store/messages.db','outside/a.md'])expect(workspaceIndexPathDecision(name,p).included).toBe(false);
 expect(workspaceIndexPathDecision('notes/x/y/draft1.md',p).included).toBe(true);
 expect(workspaceIndexPathDecision('notes/archive/a.md',p).rule).toBe('**/archive/**');
 expect(workspaceIndexPolicyRoots('notes',{roots:['notes/team','.pi/skills'],ignorePatterns:[]})).toEqual(['notes/team']);
 expect(workspaceIndexPolicyRoots('notes',{roots:['project'],ignorePatterns:[]})).toEqual([]);
 for(const root of ['/tmp','../secret','notes/../secret','C:/data','notes//x','notes/*','.piclaw','notes/family','.pi/agent'])expect(()=>validateWorkspaceIndexPolicy({roots:[root],ignorePatterns:[]})).toThrow();
 for(const rule of ['!keep','a/[xy]','a/{x,y}','(?i)case','a\\b','a/../x','a/**x'])expect(()=>validateWorkspaceIndexPolicy({roots:['notes'],ignorePatterns:[rule]})).toThrow();
 expect(()=>validateWorkspaceIndexPolicy({roots:Array(33).fill('notes'),ignorePatterns:[]})).toThrow();
});

test('saved policy preserves config, explicit empty roots and fail-closed snapshot changes',async()=>{
 await withTempWorkspaceEnv('index-policy-',{},async({workspace})=>{
  const file=join(workspace,'.piclaw/config.json');mkdirSync(join(workspace,'.piclaw'),{recursive:true});
  writeFileSync(file,JSON.stringify({web:{workspace:{treeMaxDepth:7}},other:42}));
  expect(getWorkspaceIndexPolicy().roots).toEqual(['notes','.pi/skills']);
  const snap=workspaceIndexPolicySnapshot();
  saveWorkspaceIndexPolicy({roots:[],ignorePatterns:[]});
  expect(getWorkspaceIndexPolicy().roots).toEqual([]);expect(()=>snap.validate()).toThrow();
  expect(JSON.parse(readFileSync(file,'utf8'))).toMatchObject({other:42,web:{workspace:{treeMaxDepth:7,indexing:{roots:[]}}}});
  expect(()=>saveWorkspaceIndexPolicy({roots:['../bad'],ignorePatterns:[]})).toThrow();expect(getWorkspaceIndexPolicy().roots).toEqual([]);
  writeFileSync(file,'{');expect(()=>getWorkspaceIndexPolicy()).toThrow();
 });
});

test('saved exclusions hide existing FTS rows immediately, scope cannot bypass roots, refresh prunes',async()=>{
 await withTempWorkspaceEnv('index-visible-',{PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},async({workspace})=>{
  mkdirSync(join(workspace,'notes'),{recursive:true});mkdirSync(join(workspace,'docs'),{recursive:true});
  writeFileSync(join(workspace,'notes/a.md'),'# Visible\ncobalt sunrise');writeFileSync(join(workspace,'notes/b.md'),'# Other\ncobalt sunset');writeFileSync(join(workspace,'docs/c.md'),'# Doc\ncobalt docs');
  initDatabase();try{
   saveWorkspaceIndexPolicy({roots:['notes','docs'],ignorePatterns:[]});await refreshWorkspaceIndex({scope:'all'});
   expect((await searchWorkspace({query:'cobalt'})).rows).toHaveLength(3);
   saveWorkspaceIndexPolicy({roots:['notes','docs'],ignorePatterns:['notes/a.md']});
   expect(getDb().query('SELECT count(*) n FROM workspace_files').get()).toEqual({n:3});
   const visible=await searchWorkspace({query:'cobalt'});expect(visible.rows.map(r=>r.path).sort()).toEqual(['docs/c.md','notes/b.md']);
   expect((await searchWorkspace({query:'cobalt',limit:1,offset:1})).rows).toHaveLength(1);
   await refreshWorkspaceIndex({scope:'all'});expect(getDb().query('SELECT count(*) n FROM workspace_files').get()).toEqual({n:2});
   saveWorkspaceIndexPolicy({roots:['docs'],ignorePatterns:[]});expect((await searchWorkspace({query:'cobalt',scope:'notes',refresh:true})).rows).toEqual([]);
   saveWorkspaceIndexPolicy({roots:[],ignorePatterns:[]});await refreshWorkspaceIndex({scope:'all'});expect(getDb().query('SELECT count(*) n FROM workspace_files').get()).toEqual({n:0});
  }finally{closeDatabase();}
 });
});

test('configured symlink roots and ancestor links are not read or returned',async()=>{
 await withTempWorkspaceEnv('index-links-',{PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1'},async({workspace})=>{
  mkdirSync(join(workspace,'notes'),{recursive:true});writeFileSync(join(workspace,'notes/a.md'),'cobalt');
  symlinkSync(join(workspace,'notes'),join(workspace,'alias'));
  initDatabase();try{saveWorkspaceIndexPolicy({roots:['alias'],ignorePatterns:[]});await refreshWorkspaceIndex({scope:'all'});expect((await searchWorkspace({query:'cobalt'})).rows).toHaveLength(0);}finally{closeDatabase();}
 });
});
