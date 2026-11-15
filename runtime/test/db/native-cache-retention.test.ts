import { beforeEach, afterEach, expect, test, spyOn } from "bun:test";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { storeToolOutputWithChunks, deleteToolOutputsBefore, NativeToolOutputRetentionHeld } from "../../src/db/tool-outputs.js";
import { pruneToolOutputs, pruneToolOutputFiles, migrateFlatToolOutputsToDateShards, startToolOutputCleanup, stopToolOutputCleanup } from "../../src/tool-output.js";
let workspace:ReturnType<typeof createTempWorkspace>,restore:()=>void;
beforeEach(()=>{workspace=createTempWorkspace('native-cache-retention-');restore=setEnv({PICLAW_WORKSPACE:workspace.workspace,PICLAW_STORE:workspace.store,PICLAW_DATA:workspace.data});closeDatabase();initDatabase();});
afterEach(()=>{stopToolOutputCleanup();closeDatabase();restore();workspace.cleanup();});
function seed(){const dir=join(workspace.data,'tool-output');mkdirSync(dir,{recursive:true});const path=join(dir,'history-handle.log');writeFileSync(path,'retained full native tool output');utimesSync(path,1,1);
  storeToolOutputWithChunks({id:'history-handle',created_at:'2000-01-01T00:00:00.000Z',path},['retained search content']);return path;}
const snapshot=()=>['tool_outputs','tool_outputs_fts'].map(table=>getDb().query(`SELECT rowid,* FROM ${table}`).all());
test('native cache retention: owner presence holds raw files, metadata, FTS and flat-path migration',()=>{
  const path=seed(),db=getDb();
  // Marker-only boundary fixture; actual native schema/history is qualified separately.
  db.exec('CREATE TABLE piclaw_durable_bindings_v1(id INTEGER PRIMARY KEY)');const rows=snapshot();
  for(const prune of [()=>deleteToolOutputsBefore('2026-01-01T00:00:00.000Z'),()=>pruneToolOutputs(),()=>pruneToolOutputFiles(),()=>migrateFlatToolOutputsToDateShards()])expect(prune).toThrow(NativeToolOutputRetentionHeld);
  const timer=spyOn(globalThis,'setInterval');try{startToolOutputCleanup();expect(timer).not.toHaveBeenCalled();}finally{timer.mockRestore();}
  expect(snapshot()).toEqual(rows);expect(existsSync(path)).toBe(true);
});
test('native cache retention: fresh startup preserves files before the native owner/import preflight exists',async()=>{
  const path=seed();
  const child=Bun.spawn([process.execPath,'--no-env-file','-e',`
    import {initializeRuntimeEnvironment} from ${JSON.stringify(new URL('../../src/runtime/startup.ts',import.meta.url).pathname)};
    initializeRuntimeEnvironment({loadTimestamps(){},loadChats(){}});
    const fs=await import('node:fs');console.log('CACHE_STARTUP:'+JSON.stringify({retained:fs.existsSync(${JSON.stringify(path)})}));process.exit(0);
  `],{env:{...process.env,PICLAW_DB_IN_MEMORY:'1',PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX:'1',PI_OFFLINE:'1'},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  const [status,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(status,stderr).toBe(0);const line=stdout.split('\n').find(line=>line.includes('CACHE_STARTUP:'));expect(line).toBeDefined();expect(JSON.parse(line!.slice(line!.indexOf('CACHE_STARTUP:')+'CACHE_STARTUP:'.length))).toEqual({retained:true});expect(existsSync(path)).toBe(true);
});
test('native cache retention: unavailable registration inventory never authorises orphan file deletion',()=>{
  const path=seed(),db=getDb(),prepare=db.prepare;
  db.prepare=((sql:string,...args:unknown[])=>{if(sql.startsWith('SELECT path FROM tool_outputs'))throw Error('inventory unavailable');return Reflect.apply(prepare,db,[sql,...args]);}) as typeof db.prepare;
  try{expect(()=>pruneToolOutputFiles()).toThrow('reference inventory unavailable');expect(existsSync(path)).toBe(true);}finally{db.prepare=prepare;}
});
