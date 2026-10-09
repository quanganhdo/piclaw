import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTempWorkspace } from '../helpers.js';

/** Real packaged CLI, empty profile and an explicit observer extension. No
 * prompt/provider execution: session_start records tools and requests shutdown. */
for (const flags of [['--no-mcp'],['--no-extensions']] as const) test(`Pi1.0.4 CLI ${flags[0]} prevents configured native MCP startup`,async()=>{
 const ws=createTempWorkspace('pi104-cli-loading-'),profile=join(ws.base,'profile'),marker=join(ws.base,'server-started'),record=join(ws.base,'tools.json');mkdirSync(profile,{mode:0o700});
 const server=join(ws.base,'server.mjs');writeFileSync(server,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'unexpected');process.exit(99);`);
 writeFileSync(join(profile,'mcp.json'),JSON.stringify({mcpServers:{fixture:{command:process.execPath,args:[server]}}}),{mode:0o600});
 const observer=join(ws.base,'observer.ts');writeFileSync(observer,`import{writeFileSync}from'node:fs';export default pi=>{pi.registerProvider('fixture',{baseUrl:'http://127.0.0.1:1',apiKey:'synthetic',api:'openai-completions',models:[{id:'fixture',name:'fixture',reasoning:true,input:['text'],contextWindow:1000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});pi.on('session_start',async(_event,ctx)=>{writeFileSync(${JSON.stringify(record)},JSON.stringify({thinking:pi.getThinkingLevel(),tools:pi.getAllTools().map(t=>t.name)}));ctx.shutdown();});};`);
 const cli=resolve(import.meta.dir,'../../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
 const child=Bun.spawn([process.execPath,'--no-env-file',cli,'--mode','json','--no-session','--model','fixture/fixture','--thinking','medium','--tools','read',...flags,'--extension',observer],{cwd:ws.workspace,env:{PATH:'/usr/bin:/bin',HOME:ws.base,PI_CODING_AGENT_DIR:profile,PI_OFFLINE:'1',PI_TELEMETRY:'0',OTEL_SDK_DISABLED:'true'},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
 try{const[exit,output,error]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,error+output).toBe(0);expect(existsSync(marker)).toBe(false);expect(existsSync(record),error+output).toBe(true);const r=JSON.parse(readFileSync(record,'utf8'));expect(r.thinking).toBe('medium');expect(r.tools).toContain('read');expect(r.tools.some((n:string)=>n.startsWith('mcp__'))).toBe(false);}
 finally{clearTimeout(timer);if(child.exitCode===null){child.kill('SIGKILL');await child.exited;}ws.cleanup();}
},15000);
