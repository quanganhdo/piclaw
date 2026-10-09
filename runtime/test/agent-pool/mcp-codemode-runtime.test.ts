import {expect,test} from "bun:test";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {withTempWorkspaceEnv} from "../helpers.js";
import {McpCodemodeController, resetMcpCodemodeRuntimeForTests, selectedMcpPolicy, assertSelectedMcpOwner, bindMcpCodemodePolicy} from "../../src/agent-pool/mcp-codemode-runtime.js";
import {hydrateMcpKeychainCredentials,resetMcpStartupStateForTests} from "../../src/secure/mcp-keychain.js";

async function fixture(run:(path:string)=>Promise<void>) {
  await withTempWorkspaceEnv("mcp-codemode-",{},async ws=>{
    resetMcpStartupStateForTests();resetMcpCodemodeRuntimeForTests();
    mkdirSync(join(ws.workspace,".piclaw"),{recursive:true});
    const path=join(ws.workspace,".piclaw/config.json");writeFileSync(path,JSON.stringify({domains:{access:{mode:"single-user"},other:{value:42}}}),{mode:0o600});
    try{await run(path);}finally{resetMcpStartupStateForTests();resetMcpCodemodeRuntimeForTests();}
  });
}
function harness(options:{abort?:()=>Promise<void>;snapshot?:()=>Promise<any[]>;set?:()=>void;resume?:()=>void;timeout?:number}={}) {
  const events:string[]=[];let active=["read","mcp"];
  const runtime={session:{async abort(){events.push("abort");await options.abort?.();},getAllTools:()=>[{name:"codemode"}],getActiveToolNames:()=>active,setActiveToolsByName(names:string[]){events.push("set");options.set?.();active=names;}}};
  const controller=new McpCodemodeController({blockMcpAdmissions(){events.push("fence");},async fenceMcpAndSnapshot(){events.push("snapshot");return options.snapshot?await options.snapshot():[runtime,runtime] as any;},resumeMcpAdmissions(){events.push("resume");options.resume?.();},async quarantineMcpRuntime(){events.push("quarantine");}},options.timeout??1000);
  return {controller,events,runtime,get active(){return active;},input(codemode="on"){return {policy:{engine:"adapter",codemode},revision:controller.inspect().revision,acknowledgeInterruptions:true};}};
}
test("codemode Apply fences, deduplicates aborts, updates only codemode, persists other domains and resumes",async()=>fixture(async path=>{
  const h=harness();const result=await h.controller.apply(h.input(),()=>{});
  expect(h.events).toEqual(["fence","snapshot","abort","set","resume"]);expect(h.active).toEqual(["read","mcp","codemode"]);
  expect(result.runtime.observedPolicy).toEqual({engine:"adapter",codemode:"on"});expect(selectedMcpPolicy().codemode).toBe("on");expect(Object.isFrozen(selectedMcpPolicy())).toBe(true);
  expect(JSON.parse(readFileSync(path,"utf8")).domains.other.value).toBe(42);
  await h.controller.apply(h.input("off"),()=>{});expect(h.active).toEqual(["read","mcp"]);
  const count=h.events.length;await h.controller.apply(h.input("off"),()=>{});expect(h.events).toHaveLength(count);
}));
test("native, missing acknowledgement and stale config revisions never fence or write",async()=>fixture(async path=>{
  const h=harness(),input=h.input();const original=readFileSync(path,"utf8");
  await expect(h.controller.apply({...input,policy:{engine:"native",codemode:"auto"}},()=>{})).rejects.toThrow("shutdown acknowledgement");
  await expect(h.controller.apply({...input,acknowledgeInterruptions:false},()=>{})).rejects.toThrow("Confirm");
  writeFileSync(path,original+"\n");await expect(h.controller.apply(input,()=>{})).rejects.toThrow("changed");
  expect(h.events).toEqual([]);expect(readFileSync(path,"utf8")).toBe(original+"\n");
}));
test("authorisation revocation after abort prevents commit and leaves admissions blocked",async()=>fixture(async path=>{
  const h=harness();const original=readFileSync(path,"utf8");let calls=0;
  await expect(h.controller.apply(h.input(),()=>{if(++calls===3)throw Error("Revoked");})).rejects.toThrow("remain blocked");
  expect(readFileSync(path,"utf8")).toBe(original);expect(h.events).not.toContain("resume");expect(()=>assertSelectedMcpOwner()).toThrow();expect(h.controller.inspect().runtime.observedPolicy).toBeNull();
}));
test("concurrent Apply rejects and timeout quarantines late snapshot without committing",async()=>fixture(async path=>{
  let release!:(value:any[])=>void;const snapshot=new Promise<any[]>(resolve=>{release=resolve;});
  const h=harness({snapshot:()=>snapshot,timeout:20});const original=readFileSync(path,"utf8"),input=h.input();
  const pending=h.controller.apply(input,()=>{});await expect(h.controller.apply(input,()=>{})).rejects.toThrow("busy");
  await expect(pending).rejects.toThrow("remain blocked");release([h.runtime]);await Bun.sleep(0);
  expect(h.events).toContain("quarantine");expect(h.events).not.toContain("resume");expect(readFileSync(path,"utf8")).toBe(original);
}));
test("public activation or resume failure after commit never claims rollback or successful observation",async()=>fixture(async path=>{
  const h=harness({set(){throw Error("PRIVATE_SENTINEL");}});
  await expect(h.controller.apply(h.input(),()=>{})).rejects.toThrow("Policy saved");
  expect(JSON.parse(readFileSync(path,"utf8")).domains.mcp.codemode).toBe("on");expect(h.controller.inspect().runtime.observedPolicy).toBeNull();expect(h.controller.inspect().applyAvailable).toBe(false);
}));
test("changed immutable bridge during abort prevents commit",async()=>fixture(async path=>{
  const workspace=join(path,"../..");mkdirSync(join(workspace,".pi"),{recursive:true});
  const h=harness({async abort(){writeFileSync(join(workspace,".pi/mcp.json"),JSON.stringify({mcpServers:{fixture:{command:"never-run"}}}));await hydrateMcpKeychainCredentials(workspace,()=>{throw Error("Forbidden");});}});
  const original=readFileSync(path,"utf8");await expect(h.controller.apply(h.input(),()=>{})).rejects.toThrow("remain blocked");expect(readFileSync(path,"utf8")).toBe(original);expect(h.events).not.toContain("resume");
}));
test("already captured public prompt is fenced during Apply and after failure",async()=>fixture(async()=>{
  let invoked=0,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const session={async prompt(){invoked++;},getAllTools:()=>[{name:"codemode"}],getActiveToolNames:()=>["read"],setActiveToolsByName(){}};bindMcpCodemodePolicy(session as any);await session.prompt();expect(invoked).toBe(1);
  const h=harness({abort:()=>gate});const pending=h.controller.apply(h.input(),()=>{});await Bun.sleep(0);
  expect(()=>session.prompt()).toThrow("blocked");expect(invoked).toBe(1);release();await pending;await session.prompt();expect(invoked).toBe(2);
}));
test("new session refuses a silently discarded codemode extension",async()=>fixture(async()=>{
  const session={async prompt(){},getAllTools:()=>[],getActiveToolNames:()=>[],setActiveToolsByName(){}};
  expect(()=>bindMcpCodemodePolicy(session as any)).toThrow("did not load");
}));
test("unchanged codemode activation never resets SDK pending tool discovery",async()=>fixture(async()=>{
  let sets=0;
  const session={async prompt(){},getAllTools:()=>[{name:"codemode"}],getActiveToolNames:()=>["read","mcp"],setActiveToolsByName(){sets++;}};
  bindMcpCodemodePolicy(session as any);expect(sets).toBe(0);
}));
test("hanging public abort hits deadline and quarantines without commit",async()=>fixture(async path=>{
  const h=harness({abort:()=>new Promise(()=>{}),timeout:20}),original=readFileSync(path,"utf8");
  await expect(h.controller.apply(h.input(),()=>{})).rejects.toThrow("remain blocked");
  expect(h.events).toContain("quarantine");expect(h.events).not.toContain("set");expect(h.events).not.toContain("resume");expect(readFileSync(path,"utf8")).toBe(original);
}));
test("resume refusal after commit retains saved policy but blocks observed runtime",async()=>fixture(async path=>{
  const h=harness({resume(){throw Error("Unresolved disposal");}});
  await expect(h.controller.apply(h.input(),()=>{})).rejects.toThrow("Policy saved");
  expect(h.active).toContain("codemode");expect(h.events).toContain("quarantine");expect(JSON.parse(readFileSync(path,"utf8")).domains.mcp.codemode).toBe("on");expect(h.controller.inspect().runtime.observedPolicy).toBeNull();expect(()=>assertSelectedMcpOwner()).toThrow("blocked");
}));
test("response inspection failure after resume re-fences captured prompts",async()=>fixture(async path=>{
  const h=harness({resume(){writeFileSync(path,"invalid configuration");}});
  await expect(h.controller.apply(h.input(),()=>{})).rejects.toThrow("Policy saved");
  expect(h.events).toContain("resume");expect(h.events.filter(event=>event==="fence")).toHaveLength(2);expect(()=>assertSelectedMcpOwner()).toThrow("blocked");expect(h.events).toContain("quarantine");
}));
test("persisted unsupported native selection never silently starts adapter",async()=>fixture(async path=>{
  writeFileSync(path,JSON.stringify({domains:{mcp:{engine:"native",codemode:"auto"}}}));
  expect(()=>assertSelectedMcpOwner()).toThrow("unavailable");const h=harness();expect(h.controller.inspect().runtime.observedPolicy).toBeNull();expect(h.controller.inspect().applyAvailable).toBe(false);
  await expect(h.controller.apply(h.input(),()=>{})).rejects.toThrow("replacement");expect(h.events).toEqual([]);
}));
