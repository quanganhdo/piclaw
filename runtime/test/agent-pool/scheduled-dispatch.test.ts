import { afterEach,beforeEach,expect,test,spyOn } from "bun:test";
import { mkdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace,setEnv,waitFor } from "../helpers.js";
import { closeDatabase,getDb,initDatabase } from "../../src/db/connection.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { createFamilyScheduledTask,revokeFamilyScheduledGrant } from "../../src/db/family-scheduled-grants.js";
import { claimFamilyScheduledOccurrence } from "../../src/db/family-scheduled-occurrences.js";
import { beginFamilyScheduledExecution,readOwnFamilyScheduledResult } from "../../src/db/family-scheduled-executions.js";
import { dispatchFamilyScheduledExecution as dispatch } from "../../src/agent-pool/scheduled-dispatch.js";
import { authoriseExecutionIdentity } from "../../src/agent-pool/execution-identity.js";
import { runAgentPrompt,type RunAgentOrchestratorOptions } from "../../src/agent-pool/run-agent-orchestrator.js";
import { requireOwnedSessionExecution } from "../../src/agent-pool/owned-session-access.js";
import { requireFamilyToolAccess } from "../../src/agent-pool/family-tool-access.js";
import { AgentTurnCoordinator } from "../../src/agent-pool/turn-coordinator.js";
import { getExecutionIdentity,type ExecutionIdentity } from "../../src/core/execution-context.js";
import { getChatJid } from "../../src/core/chat-context.js";
import { workspaceMemoryBootstrap } from "../../src/extensions/workspace-memory-bootstrap.js";
import { provisionFamilyAccount,updateManagedAccount } from "../../src/db/account-administration.js";
import { getUser } from "../../src/db/users.js";
import { updateAdminToolPolicy } from "../../src/db/family-tool-restrictions.js";
import { AgentPool } from "../../src/agent-pool.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,alice:AuthenticatedPrincipal,bob:AuthenticatedPrincipal,admin:AuthenticatedPrincipal;
function actor(id:string):AuthenticatedPrincipal{const user=getUser(getDb(),id)!,login=createWebSession(`token-${id}`,id,3600,"passkey");return {kind:"user",mode:"family-shared",userId:id,username:user.username,displayName:user.display_name,role:user.role,homeChatJid:user.home_chat_jid,authentication:{method:"passkey",sessionId:login.session_id!,expiresAt:login.expires_at}};}
beforeEach(()=>{
  ws=createTempWorkspace("scheduled-dispatch-");restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});mkdirSync(join(ws.workspace,".piclaw"));
  writeFileSync(join(ws.workspace,".piclaw/config.json"),JSON.stringify({domains:{access:{mode:"family-shared"}}}));closeDatabase();initDatabase();admin=actor("default");
  [alice,bob]=["alice","bob"].map(name=>{const u=provisionFamilyAccount(getDb(),admin,{username:name,displayName:name});getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(u.id,name);updateManagedAccount(getDb(),admin,u.id,{enabled:true},{totp:false,passkey:true,rpId:"family.local"});return actor(u.id);});
});
afterEach(()=>{closeDatabase();restore();ws.cleanup();});
async function handoff(owner=alice){const real=Date.now,at=Date.now()+5;let result;
  try{Date.now=()=>at-5;const grant=createFamilyScheduledTask(getDb(),owner,owner.homeChatJid!,{prompt:`prompt for ${owner.username}`,scheduled_for:new Date(at).toISOString(),allowed_tools:["read","messages"]});Date.now=()=>at;result={...beginFamilyScheduledExecution(getDb(),claimFamilyScheduledOccurrence(getDb(),grant.grant_id,"worker")),grantId:grant.grant_id};}finally{Date.now=real;}await Bun.sleep(6);return result!;}
const proof=(h:Awaited<ReturnType<typeof handoff>>)=>({execution_id:h.execution_id,token:h.token});
const failureOf=(p:Promise<unknown>)=>p.then(()=>null,error=>error);
function harness(onPrompt?:(session:any,prompt:string)=>Promise<void>|void,onHydrate?:()=>Promise<void>|void){
  const observed:{identity:ExecutionIdentity|null;prompt:string;system:string;tools:string[]}[]=[],queued:{run:()=>Promise<void>;lane:string}[]=[];
  let memory:any;workspaceMemoryBootstrap({on:(name:string,fn:any)=>{if(name==="before_agent_start")memory=fn;}} as any);
  const listeners=new Set<(e:any)=>void>();let active=["read","messages","ls","bash"],prompts=0,hydrations=0;
  const session={sessionManager:{getLeafId:()=>"leaf"},model:{provider:"test",id:"test",contextWindow:100000},isStreaming:false,isCompacting:false,isRetrying:false,
    settingsManager:{getRetrySettings:()=>({enabled:true,maxRetries:3,baseDelayMs:1,maxDelayMs:10})},
    getActiveToolNames:()=>active,setActiveToolsByName:(v:string[])=>{active=v;},subscribe:(fn:(e:any)=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},abort:async()=>{},
    prompt:async(prompt:string)=>{prompts++;const context=await memory({systemPrompt:"BASE"});observed.push({identity:getExecutionIdentity(),prompt,system:context.systemPrompt,tools:[...active]});await onPrompt?.(session,prompt);
      const message={role:"assistant",content:[{type:"text",text:"scheduled answer"}],provider:"test",model:"test",stopReason:"stop",timestamp:Date.now()};
      for(const fn of listeners){fn({type:"message_update",assistantMessageEvent:{type:"text_delta",delta:"scheduled answer"}});fn({type:"message_update",assistantMessageEvent:{type:"message_end",message}});}
    }};
  const options:RunAgentOrchestratorOptions={getOrCreateRuntime:async()=>{hydrations++;requireOwnedSessionExecution(getChatJid());await onHydrate?.();return {session,services:{settingsManager:{getRetrySettings:()=>({enabled:true,maxRetries:3})}},dispose:async()=>{}} as any;},turnCoordinator:new AgentTurnCoordinator({takeAttachments:()=>[],touchSession:()=>{},recordMessageUsage:()=>{}}),clearAttachments:()=>{},takeAttachments:()=>[],logsDir:join(ws.workspace,"logs"),setActiveForkBaseLeaf:()=>{},clearActiveForkBaseLeaf:()=>{}};
  const deps={queue:{enqueue:(run:()=>Promise<void>,_id:string,lane:string)=>{queued.push({run,lane});}},agentPool:{runAgent:(p:string,c:string,o:any)=>runAgentPrompt(p,c,o,options)}};
  return {deps,queued,session,options,observed,get prompts(){return prompts;},get hydrations(){return hydrations;}};
}

test("dispatcher uses exact owner prompt/system context/tool ceiling and settles without publication or tokens",async()=>{
  const cap=await handoff(),h=harness(()=>{requireFamilyToolAccess("read");expect(()=>requireFamilyToolAccess("ls")).toThrow();expect(()=>requireFamilyToolAccess("bash")).toThrow();});
  const pending=dispatch(proof(cap),h.deps);expect(h.queued[0].lane).toBe(`chat:${alice.homeChatJid}`);await h.queued[0].run();expect(await pending).toEqual({execution_id:cap.execution_id,settled:true});
  expect(h.prompts).toBe(1);expect(h.observed[0].prompt).toBe("prompt for alice");expect(h.observed[0].system).toContain('Username: "alice"');expect(h.observed[0].system).toContain("Execution service: scheduler");expect(h.observed[0].tools).toEqual(["read","messages"]);expect(JSON.stringify(h.observed)).not.toContain(cap.token);
  expect(readOwnFamilyScheduledResult(getDb(),alice,cap.execution_id).result?.text).toBe("scheduled answer");expect(getDb().query("SELECT count(*) n FROM messages").get()).toEqual({n:0});expect(getExecutionIdentity()).toBeNull();
  await expect(dispatch(proof(cap),h.deps)).rejects.toThrow();
});

test("raw scheduled provenance and wrong prompt cannot borrow dispatcher admission",async()=>{
  const cap=await handoff(),h=harness();
  expect(()=>authoriseExecutionIdentity(getDb(),"family-shared",alice.homeChatJid!,{kind:"scheduled",actorUserId:alice.userId,ownerUserId:alice.userId,chatJid:alice.homeChatJid!,executionId:cap.execution_id})).toThrow();
  h.deps.agentPool.runAgent=(_p,c,o)=>runAgentPrompt("injected prompt",c,o,h.options);
  const caught=failureOf(dispatch(proof(cap),h.deps));await h.queued[0].run();expect(await caught).toBeInstanceOf(Error);expect(h.hydrations).toBe(0);
  const denied=failureOf(dispatch(proof(cap),h.deps));await h.queued[1].run();expect(await denied).toBeInstanceOf(Error);expect(h.prompts).toBe(0);
});

test("revocation at queue and hydration boundaries prevents prompt and settlement",async()=>{
  const cap=await handoff(),h=harness();const denied=failureOf(dispatch(proof(cap),h.deps));revokeFamilyScheduledGrant(getDb(),alice,cap.grantId);await h.queued[0].run();expect(await denied).toBeInstanceOf(Error);expect(h.hydrations).toBe(0);
  const next=await handoff(),other=harness(undefined,()=>{revokeFamilyScheduledGrant(getDb(),alice,next.grantId);});const failure=failureOf(dispatch(proof(next),other.deps));await other.queued[0].run();expect(await failure).toBeInstanceOf(Error);expect(other.prompts).toBe(0);
  expect(getDb().query("SELECT count(*) n FROM family_scheduled_results").get()).toEqual({n:0});
});

test("logout survives but disable or policy removal during prompt fences tools and output",async()=>{
  const cap=await handoff(),h=harness(()=>{getDb().query("DELETE FROM web_sessions WHERE user_id=?").run(alice.userId);requireFamilyToolAccess("read");});const p=dispatch(proof(cap),h.deps);await h.queued[0].run();await p;
  alice=actor(alice.userId);const next=await handoff(),other=harness(()=>{updateAdminToolPolicy(getDb(),admin,alice.userId,{confirm_username:"alice",expected_revision:0,denied_tools:["read"]});expect(()=>requireFamilyToolAccess("read")).toThrow();});
  const fail=failureOf(dispatch(proof(next),other.deps));await other.queued[0].run();expect(await fail).toBeInstanceOf(Error);expect(readOwnFamilyScheduledResult(getDb(),alice,next.execution_id).state).toBe("unsettled");
});

test("duplicate queue delivery starts at most once and mismatched target is denied before hydration",async()=>{
  const cap=await handoff(),h=harness();h.deps.agentPool.runAgent=(p,_c,o)=>runAgentPrompt(p,bob.homeChatJid!,o,h.options);
  const failed=failureOf(dispatch(proof(cap),h.deps));await h.queued[0].run();expect(await failed).toBeInstanceOf(Error);await h.queued[0].run();expect(h.hydrations).toBe(0);expect(getDb().query("SELECT count(*) n FROM family_scheduled_dispatches").get()).toEqual({n:1});
});

test("scope is closed to detached tool work after return",async()=>{
  const cap=await handoff();let later:Promise<void>|undefined;const release=Promise.withResolvers<void>();
  const h=harness(()=>{later=(async()=>{await release.promise;expect(()=>requireFamilyToolAccess("read")).toThrow();})();});
  const p=dispatch(proof(cap),h.deps);await h.queued[0].run();await p;release.resolve();await later;expect(h.prompts).toBe(1);
});

test("second entry and caught wrong-prompt attempts permanently deny a scope",async()=>{
  for(const wrongFirst of [false,true]){
    const cap=await handoff(),h=harness(),first=h.deps.agentPool.runAgent;
    h.deps.agentPool.runAgent=async(p,c,o)=>{const answer=await first(wrongFirst?"wrong":p,c,o);const second=await first(p,c,o);expect(second.error).toBe("Session access denied.");return answer;};
    const failed=failureOf(dispatch(proof(cap),h.deps));await h.queued[0].run();expect(await failed).toBeInstanceOf(Error);expect(h.prompts).toBe(wrongFirst?0:1);
  }
});

test("SDK retry getter is disabled only during scheduled prompt and restored after errors",async()=>{
  const cap=await handoff(),h=harness(session=>{expect(session.settingsManager.getRetrySettings()).toMatchObject({enabled:false,maxRetries:0});throw Error("retryable provider failure");});
  const original=h.session.settingsManager.getRetrySettings;
  const pending=dispatch(proof(cap),h.deps);await h.queued[0].run();await pending;expect(h.prompts).toBe(1);expect(h.session.settingsManager.getRetrySettings).toBe(original);
  expect(h.session.settingsManager.getRetrySettings().enabled).toBe(true);
});

test("two concurrent owners retain separate identities and current profile/preferences snapshots",async()=>{
  const a=await handoff(),b=await handoff(bob);getDb().query("UPDATE users SET display_name='Alice Updated' WHERE id=?").run(alice.userId);
  const ha=harness(async()=>{await Bun.sleep(15);expect(getExecutionIdentity()?.username).toBe("alice");});
  const hb=harness(async()=>{await Bun.sleep(2);expect(getExecutionIdentity()?.username).toBe("bob");});
  const pa=dispatch(proof(a),ha.deps),pb=dispatch(proof(b),hb.deps);await Promise.all([ha.queued[0].run(),hb.queued[0].run()]);await Promise.all([pa,pb]);
  expect(ha.observed[0].system).toContain('Display name: "Alice Updated"');expect(hb.observed[0].system).toContain('Username: "bob"');
});

test("shared SDK retry manager retains ordinary settings and overlapping scheduled scopes restore in any order",async()=>{
  const a=await handoff(),b=await handoff(bob),releaseA=Promise.withResolvers<void>(),releaseB=Promise.withResolvers<void>();let entered=0;
  const shared={getRetrySettings:()=>({enabled:true,maxRetries:3,baseDelayMs:1,maxDelayMs:10})},original=shared.getRetrySettings;
  const ha=harness(async()=>{entered++;expect(shared.getRetrySettings().enabled).toBe(false);await releaseA.promise;expect(shared.getRetrySettings().enabled).toBe(false);});
  const hb=harness(async()=>{entered++;expect(shared.getRetrySettings().enabled).toBe(false);await releaseB.promise;expect(shared.getRetrySettings().enabled).toBe(false);});
  ha.session.settingsManager=shared;hb.session.settingsManager=shared;
  const pa=dispatch(proof(a),ha.deps),pb=dispatch(proof(b),hb.deps),laneA=ha.queued[0].run(),laneB=hb.queued[0].run();
  try{await waitFor(()=>entered===2);expect(shared.getRetrySettings()).toEqual({enabled:true,maxRetries:3,baseDelayMs:1,maxDelayMs:10});
    releaseA.resolve();await laneA;await pa;expect(shared.getRetrySettings).not.toBe(original);expect(shared.getRetrySettings().enabled).toBe(true);
    releaseB.resolve();await laneB;await pb;expect(shared.getRetrySettings).toBe(original);
  }finally{releaseA.resolve();releaseB.resolve();await Promise.all([laneA,laneB]);}
});

test("mode change and busy targets never enter a scheduled model prompt",async()=>{
  const cap=await handoff(),h=harness(undefined,()=>{writeFileSync(join(ws.workspace,".piclaw/config.json"),JSON.stringify({domains:{access:{mode:"single-user"}}}));});
  const failed=failureOf(dispatch(proof(cap),h.deps));await h.queued[0].run();expect(await failed).toBeInstanceOf(Error);expect(h.prompts).toBe(0);
  writeFileSync(join(ws.workspace,".piclaw/config.json"),JSON.stringify({domains:{access:{mode:"family-shared"}}}));
  const next=await handoff(),other=harness();other.session.isStreaming=true;
  const blocked=failureOf(dispatch(proof(next),other.deps));await other.queued[0].run();expect(await blocked).toBeInstanceOf(Error);expect(other.prompts).toBe(0);
});

test("model errors get one prompt attempt, no recovery/rotation, and one bounded error result",async()=>{
  const cap=await handoff(),h=harness(()=>{throw Error("provider failed");});const pending=dispatch(proof(cap),h.deps);await h.queued[0].run();await pending;
  expect(h.prompts).toBe(1);expect(readOwnFamilyScheduledResult(getDb(),alice,cap.execution_id).result?.status).toBe("error");
});

test("queue expiry prevents late admission; timeout closes scope and holds lane until lingering model settles",async()=>{
  const cap=await handoff(),h=harness();let expireQueue:(()=>void)|undefined,expireRun:(()=>void)|undefined;
  const original=globalThis.setTimeout;const spy=spyOn(globalThis,"setTimeout").mockImplementation(((fn:any,ms:number,...args:any[])=>{if(ms===30000){expireQueue=fn;return {unref(){}} as any;}if(ms===60000){expireRun??=fn;return {unref(){}} as any;}return original(fn,ms,...args);}) as any);
  try{
    const failure=failureOf(dispatch(proof(cap),h.deps));expireQueue!();expect(String(await failure)).toContain("queue wait expired");await h.queued[0].run();expect(h.prompts).toBe(0);
    const release=Promise.withResolvers<void>();let entered=false;
    const other=harness(async()=>{entered=true;await release.promise;expect(()=>requireFamilyToolAccess("read")).toThrow();});
    const denied=failureOf(dispatch(proof(cap),other.deps));let done=false;
    const lane=other.queued[0].run().then(()=>{done=true;});await waitFor(()=>entered);expireRun!();expect(String(await denied)).toContain("deadline expired");expect(done).toBe(false);release.resolve();await lane;expect(done).toBe(true);
    expect(getDb().query("SELECT count(*) n FROM family_scheduled_results").get()).toEqual({n:0});
  }finally{spy.mockRestore();}
});

test("real AgentPool runAgent wrapper uses the same one-shot prompt path",async()=>{
  const cap=await handoff(),h=harness();let released=0;
  const pool={sessionManager:{acquireEvictionProtection:()=>()=>{released++;}},getOrCreateRuntime:h.options.getOrCreateRuntime,turnCoordinator:h.options.turnCoordinator,
    attachments:{clear:()=>{},take:()=>[]},logsDir:join(ws.workspace,"logs"),activeForkBaseLeafByChat:new Map(),recoveryStats:{attemptsTotal:0,recoveredRuns:0,exhaustedRuns:0}};
  h.deps.agentPool.runAgent=(p,c,o)=>AgentPool.prototype.runAgent.call(pool as any,p,c,o);
  const pending=dispatch(proof(cap),h.deps);await h.queued[0].run();await pending;expect(h.prompts).toBe(1);expect(released).toBe(1);
});

test("admission insertion failure rolls back without hydration; completed or forged capabilities never queue",async()=>{
  const cap=await handoff(),h=harness();getDb().exec("CREATE TRIGGER fail_dispatch BEFORE INSERT ON family_scheduled_dispatches BEGIN SELECT RAISE(ABORT,'admission failed'); END");
  const failed=failureOf(dispatch(proof(cap),h.deps));await h.queued[0].run();expect(String(await failed)).toContain('admission failed');expect(h.hydrations).toBe(0);
  expect(getDb().query('SELECT count(*) n FROM family_scheduled_dispatches').get()).toEqual({n:0});getDb().exec('DROP TRIGGER fail_dispatch');
  for(const value of [{...proof(cap),token:'x'.repeat(43)},{...proof(cap),owner:alice.userId}])await expect(dispatch(value,h.deps)).rejects.toThrow();
  expect(h.queued).toHaveLength(1);
  const pending=dispatch(proof(cap),h.deps);await h.queued[1].run();await pending;await expect(dispatch(proof(cap),h.deps)).rejects.toThrow();
});

test("missing SDK retry controls and unobserved prompt bypass leave no result",async()=>{
  const cap=await handoff(),h=harness();delete (h.session as any).settingsManager;
  const failed=failureOf(dispatch(proof(cap),h.deps));await h.queued[0].run();expect(await failed).toBeInstanceOf(Error);expect(h.prompts).toBe(0);
  const next=await handoff(),other=harness();other.deps.agentPool.runAgent=async()=>({status:'success',result:'fabricated dependency return'});
  const denied=failureOf(dispatch(proof(next),other.deps));await other.queued[0].run();expect(await denied).toBeInstanceOf(Error);
  expect(getDb().query('SELECT count(*) n FROM family_scheduled_results').get()).toEqual({n:0});
});

test("disabled owner while model waits loses tool and settlement authority",async()=>{
  const cap=await handoff(),h=harness(()=>{getDb().query('UPDATE users SET enabled=0 WHERE id=?').run(alice.userId);expect(()=>requireFamilyToolAccess('read')).toThrow();});
  const denied=failureOf(dispatch(proof(cap),h.deps));await h.queued[0].run();expect(await denied).toBeInstanceOf(Error);
  expect(getDb().query('SELECT count(*) n FROM family_scheduled_results').get()).toEqual({n:0});
});
