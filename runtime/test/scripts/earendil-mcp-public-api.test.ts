import {afterEach,expect,test} from 'bun:test';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {EXACT_CONTRACT_SHA256,expectedNegatives,lifecycleProbe,run,validateContract} from '../../../scripts/check-earendil-mcp-public-api.ts';
const root=resolve(import.meta.dir,'../../..'),contract=resolve(import.meta.dir,'../fixtures/earendil-mcp-0991-contract.json'),tsc=resolve(root,'node_modules/.bin/tsc');
const installedConsumer=process.env.EARENDIL_0991_CONSUMER;
const scratch:string[]=[];afterEach(()=>{for(const path of scratch.splice(0))rmSync(path,{recursive:true,force:true});});
function copyContract(update:(value:any)=>void){const directory=mkdtempSync(join(tmpdir(),'mcp-contract-'));scratch.push(directory);const path=join(directory,'contract.json'),value=JSON.parse(readFileSync(contract,'utf8'));update(value);writeFileSync(path,JSON.stringify(value));return path;}
test('exact 0.99.1 MCP matrix is frozen and has one admitted row',()=>{const receipt=validateContract(contract);expect(receipt.hash).toBe(EXACT_CONTRACT_SHA256);expect(receipt.value.requirements).toHaveLength(15);expect(receipt.value.requirements.filter((row:any)=>row.status==='pass').map((row:any)=>row.id)).toEqual(['MCP-01']);expect(receipt.value.requirements.filter((row:any)=>['blocked','fail'].includes(row.status)).map((row:any)=>row.id)).toEqual(['MCP-03','MCP-06','MCP-07','MCP-08','MCP-10','MCP-11','MCP-12','MCP-15']);expect(Object.fromEntries(receipt.value.requirements.map((row:any)=>[row.id,row.owner]))).toMatchObject({'MCP-02':'1446','MCP-03':'1446,1450','MCP-06':'1447,1449','MCP-15':'1454,1455,1456'});});
test('matrix mutation, missing rows and promoted unsupported rows fail closed',()=>{
 expect(()=>validateContract(copyContract(value=>value.requirements.pop()))).toThrow('hash differs');
 expect(()=>validateContract(copyContract(value=>value.requirements[1].status='pass'))).toThrow('hash differs');
 expect(()=>validateContract(copyContract(value=>value.forbiddenWorkarounds=[]))).toThrow('hash differs');
});
test('public contract probe compiles supported seams and rejects every named blocker',async()=>{
 // The actual packed consumer is supplied by the #1443 admission procedure.
 if(!installedConsumer||!existsSync(installedConsumer))return;
 const receipt=await run({consumerRoot:installedConsumer,tsc,contract});expect(receipt.positive).toBe('pass');expect(receipt.negative).toEqual(expectedNegatives.map(([symbol,code])=>({symbol,code})));expect(receipt.lifecycle).toEqual({runtimeLoads:2,connectionsConstructed:1,clientStarts:0,connectionCloses:0,toolRegistrations:0,classification:'generation_gate_prevents_resources_transient_unclosed_object'});
});
test('delayed startup shutdown creates no client, transport or tool registration',async()=>{if(!installedConsumer||!existsSync(installedConsumer))return;expect(await lifecycleProbe(installedConsumer)).toMatchObject({runtimeLoads:2,connectionsConstructed:1,clientStarts:0,connectionCloses:0,toolRegistrations:0});});
