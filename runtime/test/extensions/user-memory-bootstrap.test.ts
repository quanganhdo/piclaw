import { beforeEach, afterEach, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { createTempWorkspace,setEnv } from "../helpers.js";
import { workspaceMemoryBootstrap } from "../../src/extensions/workspace-memory-bootstrap.js";
import { withExecutionIdentity,type ExecutionIdentity } from "../../src/core/execution-context.js";
import { withChatContext } from "../../src/core/chat-context.js";
let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,handler:(event:any)=>Promise<any>;
const configure=(mode:string)=>fs.writeFileSync(join(ws.workspace,".piclaw/config.json"),mode==="invalid"?"{":JSON.stringify({domains:{access:{mode}}}));
const identity:ExecutionIdentity={mode:"single-user",username:"default",displayName:"Owner",role:"admin",rootChatJid:"web:default",provenance:{actorUserId:"default",ownerUserId:"default",chatJid:"web:default",kind:"interactive"}};
const call=(owner:ExecutionIdentity|null=null,event:any={systemPrompt:"base"})=>withExecutionIdentity(owner,()=>withChatContext("web:default","web",()=>handler(event)));
beforeEach(()=>{
 ws=createTempWorkspace("single-user-memory-");restore=setEnv({PICLAW_WORKSPACE:ws.workspace});fs.mkdirSync(join(ws.workspace,".piclaw"));configure("single-user");
 for(const [name,text] of [["notes/memory/MEMORY.md","MEMORY"],["notes/index.md","INDEX"],["notes/preferences/agent.md","PREFERENCE"]]){const p=join(ws.workspace,name!);fs.mkdirSync(join(p,".."),{recursive:true});fs.writeFileSync(p,text!);}
 workspaceMemoryBootstrap({on:(event:string,fn:any)=>{expect(event).toBe("before_agent_start");handler=fn;}} as any);
});afterEach(()=>{restore();ws.cleanup();});
test("single-user notes load with optional owner identity",async()=>{
 for(const owner of [null,identity]){const out=await call(owner);for(const text of ["base","MEMORY","INDEX","PREFERENCE"])expect(out.systemPrompt).toContain(text);expect(out.systemPrompt.includes("Current user")).toBe(Boolean(owner));}
});
test("unsupported mode or foreign identity denies before event and note reads",async()=>{
 const event=new Proxy({}, {get(){throw Error("premature event read");}});
 for(const mode of ["family-shared","invalid"]){configure(mode);await expect(call(null,event)).rejects.toThrow();}
 configure("single-user");await expect(call({...identity,provenance:{...identity.provenance,ownerUserId:"foreign"}},event)).rejects.toThrow("access denied");
});
test("mode changes during memory reads cannot release gathered text",async()=>{
 const read=fs.readFileSync;const spy=spyOn(fs,"readFileSync").mockImplementation(((path:any,...args:any[])=>{const result=Reflect.apply(read,fs,[path,...args]);if(String(path).endsWith("MEMORY.md"))configure("family-shared");return result;}) as any);
 try{await expect(call()).rejects.toThrow("access denied");}finally{spy.mockRestore();}
});
test("event getters cannot change authority before prompt projection",async()=>{
 const event={get systemPrompt(){configure("family-shared");return "base";}};await expect(call(null,event)).rejects.toThrow("access denied");
});
