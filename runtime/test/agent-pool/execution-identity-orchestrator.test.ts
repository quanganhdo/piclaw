import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentPrompt } from "../../src/agent-pool/run-agent-orchestrator.js";
import { AgentTurnCoordinator } from "../../src/agent-pool/turn-coordinator.js";
import { getDb, initDatabase, closeDatabase } from "../../src/db/connection.js";
import { storeChatMetadata } from "../../src/db/messages.js";
import { ensureChatBranch } from "../../src/db/chat-branches.js";
import { provisionUserHome } from "../../src/db/session-ownership.js";
import { getExecutionIdentity } from "../../src/core/execution-context.js";
import { setEnv } from "../helpers.js";
import { createWebSession } from "../../src/db/web-sessions.js";

test("orchestrator rejects mismatched provenance before hydration and carries valid owner into hydration",async()=>{
 const workspace=mkdtempSync(join(tmpdir(),"piclaw-run-owner-"));
 const restore=setEnv({PICLAW_WORKSPACE:workspace,PICLAW_STORE:join(workspace,"store"),PICLAW_DATA:join(workspace,"data"),PICLAW_DB_IN_MEMORY:"1"});
 try {
  mkdirSync(join(workspace,".piclaw"));writeFileSync(join(workspace,".piclaw/config.json"),JSON.stringify({domains:{access:{mode:"family-shared"}}}));
  initDatabase();storeChatMetadata("web:default",new Date().toISOString(),"root");ensureChatBranch({chat_jid:"web:default"});provisionUserHome(getDb(),"default","web:default");
  let hydrated=0;let observed:string|undefined;
  const options={getOrCreateRuntime:async()=>{hydrated++;observed=getExecutionIdentity()?.username;throw Error("fixture stop after hydration entry");},turnCoordinator:new AgentTurnCoordinator({takeAttachments:()=>[],touchSession:()=>{},recordMessageUsage:()=>{}}),clearAttachments:()=>{},takeAttachments:()=>[],logsDir:join(workspace,"logs"),setActiveForkBaseLeaf:()=>{},clearActiveForkBaseLeaf:()=>{}};
  const missing=await runAgentPrompt("prompt","web:default",{skipPrePromptCompaction:true},options);
  expect(missing.status).toBe("error");expect(hydrated).toBe(0);
  const denied=await runAgentPrompt("prompt","web:default",{skipPrePromptCompaction:true,executionProvenance:{actorUserId:"foreign",ownerUserId:"default",chatJid:"web:default",kind:"scheduled"}},options);
  expect(denied.status).toBe("error");expect(hydrated).toBe(0);
  const unsupported=await runAgentPrompt("prompt","web:default",{skipPrePromptCompaction:true,executionProvenance:{actorUserId:"default",ownerUserId:"default",chatJid:"web:default",kind:"scheduled"}},options);
  expect(unsupported.error).toBe("Session access denied.");expect(hydrated).toBe(0);
  const login=createWebSession('orchestrator-owner-login','default',3600,'passkey');
  const valid=await runAgentPrompt("prompt","web:default",{skipPrePromptCompaction:true,executionProvenance:{actorUserId:"default",ownerUserId:"default",chatJid:"web:default",kind:"interactive",authenticationSessionId:login.session_id!}},options);
  expect(valid.error).toContain("fixture stop");expect(hydrated).toBe(1);expect(observed).toBe("default");expect(getExecutionIdentity()).toBeNull();
 } finally {restore();rmSync(workspace,{recursive:true,force:true});}
});

test('family orchestrator rejects a session without tool controls before calling prompt', async () => {
 const workspace=mkdtempSync(join(tmpdir(),'piclaw-family-ceiling-'));
 const restore=setEnv({PICLAW_WORKSPACE:workspace,PICLAW_STORE:join(workspace,'store'),PICLAW_DATA:join(workspace,'data')});
 try {
  mkdirSync(join(workspace,'.piclaw')); writeFileSync(join(workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));
  closeDatabase(); initDatabase(); storeChatMetadata('web:default',new Date().toISOString(),'root'); ensureChatBranch({chat_jid:'web:default'}); provisionUserHome(getDb(),'default','web:default');
  let prompts=0;
  const session={sessionManager:{getLeafId:()=>null},model:null,isStreaming:false,isCompacting:false,isRetrying:false,prompt:async()=>{prompts++;},subscribe:()=>()=>{}};
  const login=createWebSession('orchestrator-ceiling-login','default',3600,'passkey');
  const result=await runAgentPrompt('hello','web:default',{skipPrePromptCompaction:true,executionProvenance:{actorUserId:'default',ownerUserId:'default',chatJid:'web:default',kind:'interactive',authenticationSessionId:login.session_id!}},{
   getOrCreateRuntime:async()=>({session,services:{},dispose:async()=>{}} as any),turnCoordinator:new AgentTurnCoordinator({takeAttachments:()=>[],touchSession:()=>{},recordMessageUsage:()=>{}}),
   clearAttachments:()=>{},takeAttachments:()=>[],logsDir:join(workspace,'logs'),setActiveForkBaseLeaf:()=>{},clearActiveForkBaseLeaf:()=>{},
  });
  expect(result.status).toBe('error'); expect(result.error).toContain('requires active-tool controls'); expect(prompts).toBe(0);
 } finally { closeDatabase(); restore(); rmSync(workspace,{recursive:true,force:true}); }
});
