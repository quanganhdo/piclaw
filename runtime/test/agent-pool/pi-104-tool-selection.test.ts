import { expect, test } from 'bun:test';
import { createAgentSession, SettingsManager, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createTempWorkspace } from '../helpers.js';

/** Actual released SDK registration/loadout, not a mocked name matcher. */
for (const mode of ['builtins','mcp-pattern','exclude','empty'] as const) test(`Pi1.0.4 tool selection: ${mode}`, async () => {
 const ws=createTempWorkspace('pi104-tool-selection-');
 const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false});
 const customTools=[{name:'mcp__fixture__read',label:'fixture',description:'synthetic MCP-name tool',parameters:{type:'object',properties:{}},execute:async()=>({content:[],details:{}})},{name:'mcp__other__read',label:'other',description:'synthetic other server',parameters:{type:'object',properties:{}},execute:async()=>({content:[],details:{}})}];
 const options=mode==='builtins'?{tools:['read']}:mode==='mcp-pattern'?{tools:['read','mcp__fixture__*']}:mode==='exclude'?{tools:['read'],excludeTools:['mcp__*']}:{tools:[]};
 let result:Awaited<ReturnType<typeof createAgentSession>>|undefined;
 try{
  result=await createAgentSession({cwd:ws.workspace,agentDir:ws.workspace,modelRuntime:runtime,settingsManager:SettingsManager.inMemory(),customTools,...options});
  const names=result.session.getAllTools().map(tool=>tool.name);
  expect(names.includes('mcp__fixture__read')).toBe(mode==='builtins'||mode==='mcp-pattern');
  expect(names.includes('mcp__other__read')).toBe(mode==='builtins');
  expect(names.includes('read')).toBe(mode!=='empty');
 }finally{await result?.session.dispose();ws.cleanup();}
});
