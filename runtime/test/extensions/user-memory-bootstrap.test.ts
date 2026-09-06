import { expect, test } from "bun:test";
import { workspaceMemoryBootstrap } from "../../src/extensions/workspace-memory-bootstrap.js";
import { withExecutionIdentity, type ExecutionIdentity } from "../../src/core/execution-context.js";
import { withChatContext } from "../../src/core/chat-context.js";

function identity(name: string): ExecutionIdentity {return {provenance:{actorUserId:`user-${name}`,ownerUserId:`user-${name}`,chatJid:`web:${name}`,kind:"interactive"},username:name,displayName:name,role:"member",rootChatJid:`web:${name}`,mode:"family-shared"};}

test("registered before-agent hook injects only the selected owner's memory paths and name",async()=>{
 let handler:any;
 workspaceMemoryBootstrap({on:(event:string,fn:any)=>{expect(event).toBe("before_agent_start");handler=fn;}} as any);
 for(const name of ["alice","bob"]){
  const result=await withExecutionIdentity(identity(name),()=>withChatContext(`web:${name}`,"web",()=>handler({systemPrompt:"base"})));
  expect(result.systemPrompt).toContain(`Username: "${name}"`);
  expect(result.systemPrompt).toContain(`notes/users/user-${name}/MEMORY.md`);
  expect(result.systemPrompt).toContain("notes/family/MEMORY.md");
  expect(result.systemPrompt).not.toContain("notes/memory/MEMORY.md");
  expect(result.systemPrompt).not.toContain(`notes/users/user-${name==="alice"?"bob":"alice"}`);
  expect(result.message).toBeUndefined();
 }
});

test("hook rejects mismatched chat context and unsafe owner paths",async()=>{
 let handler:any;workspaceMemoryBootstrap({on:(_e:string,fn:any)=>{handler=fn;}} as any);
 await expect(withExecutionIdentity(identity("alice"),()=>withChatContext("web:bob","web",()=>handler({systemPrompt:"base"})))).rejects.toThrow("does not match");
 const unsafe={...identity("alice"),provenance:{...identity("alice").provenance,ownerUserId:"../../bob"}};
 await expect(withExecutionIdentity(unsafe,()=>withChatContext("web:alice","web",()=>handler({systemPrompt:"base"})))).rejects.toThrow("Invalid memory owner");
});

test("legacy single-user prompt bootstrap is unchanged when identity scope is absent",async()=>{
 let handler:any;workspaceMemoryBootstrap({on:(_e:string,fn:any)=>{handler=fn;}} as any);
 const result=await handler({systemPrompt:"base"});
 expect(result.systemPrompt).toContain("notes/memory/MEMORY.md");
 expect(result.systemPrompt).not.toContain("Current user (runtime identity)");
});
