import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createAgentSession, createAgentSessionRuntime, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { acknowledgeMcpSessionsShutdown, reloadAcknowledgedMcpSessions, createMcpBridgeOwner, bindMcpBridgeOwner, type McpShutdownReceipt } from "../../../src/agent-pool/mcp-bridge-owner.js";
import { acquireMcpSessionBridge, hydrateMcpKeychainCredentials, resetMcpStartupStateForTests } from "../../../src/secure/mcp-keychain.js";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createLogger, debugSuppressedError } from "../../../src/utils/logger.js";
const log = createLogger("mcp-public-shutdown-fixture");
const mode = process.argv[2], root = process.argv[3]!;
assert(["success", "settings-reload", "close-failure"].includes(mode));
const require = createRequire(import.meta.url);
const { createMcpAdapter, MCP_STATUS_EVENT } = require("pi-mcp-adapter") as { MCP_STATUS_EVENT: string; createMcpAdapter(options: { config: unknown; initializeOnLoad: boolean; resolveRuntimeEnv(name: string): Readonly<NodeJS.ProcessEnv>; onLifecycle(handle: { shutdown(reason?: string): Promise<void> }): void }): ExtensionFactory };
let connected = 0;
const recordsPath = join(root, "pids"); mkdirSync(recordsPath);
const server = join(root, "server.mjs");
writeFileSync(server, `import{writeFileSync}from'node:fs';import{createInterface}from'node:readline';writeFileSync(process.argv[2]+'/'+process.pid+'.json',JSON.stringify({pid:process.pid}));const send=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;if(r.method==='initialize')send(r.id,{protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}});else if(r.method==='tools/list')send(r.id,{tools:[]});else if(r.method==='resources/list')send(r.id,{resources:[]});else if(r.method==='prompts/list')send(r.id,{prompts:[]});else send(r.id,{});});`);
mkdirSync(join(root, ".pi"));
writeFileSync(join(root, ".pi/mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [server, recordsPath], lifecycle: "eager", bearerTokenKeychain: "synthetic", bearerTokenEnv: "SYNTHETIC_BEARER" } } }));
process.env.PICLAW_WORKSPACE = root; process.env.PICLAW_PI_AGENT_DIR = join(root, "agent"); process.env.PI_CODING_AGENT_DIR = join(root, "agent");
let externalNetwork = 0;
const deny = () => { externalNetwork++; throw Error("External network denied"); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
await hydrateMcpKeychainCredentials(root, () => ({ secret: "synthetic-value" } as any));
const leases: Array<{ releaseCount: number; env: () => Readonly<NodeJS.ProcessEnv> }> = [];
const owner = createMcpBridgeOwner((bridge, onLifecycle) => pi => {
  pi.events.on(MCP_STATUS_EVENT, (snapshot: any) => { if (snapshot.connectedCount === 1) connected++; });
  return createMcpAdapter({ config: bridge.config, initializeOnLoad: false, resolveRuntimeEnv: name => bridge.resolveRuntimeEnv(name), onLifecycle })(pi);
}, () => {
  const bridge = acquireMcpSessionBridge(); const row = { releaseCount: 0, env: () => bridge.resolveRuntimeEnv("fixture") }; leases.push(row);
  return { ...bridge, release() { row.releaseCount++; bridge.release(); } };
}, { requireLifecycle: true });
const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
const settingsManager = SettingsManager.inMemory();
const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [owner.extension] });
await loader.reload(); owner.assertLoaded(loader.getExtensions());
const result = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(root), noTools: "builtin" });
bindMcpBridgeOwner(result.session, loader, owner);
const runtime = await createAgentSessionRuntime(async () => ({ ...result, services: { cwd: root, agentDir: join(root, "agent"), modelRuntime, settingsManager, resourceLoader: loader, diagnostics: [] }, diagnostics: [] }), { cwd: root, agentDir: join(root, "agent"), sessionManager: result.session.sessionManager });
const session = runtime.session;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pids = () => readdirSync(recordsPath).map(path => JSON.parse(readFileSync(join(recordsPath, path), "utf8")).pid as number).filter(alive);
async function wait(predicate: () => boolean, label: string) { const until = Date.now() + 5000; while (!predicate()) { assert(Date.now() < until, JSON.stringify({ label, connected, pids: pids(), leases: leases.length })); await Bun.sleep(10); } }
const originalClose = StdioClientTransport.prototype.close;
try {
  const extensionErrors: string[] = [];
  await session.bindExtensions({ mode: "rpc", onError: event => { extensionErrors.push(event.error); } }); await wait(() => pids().length === 1 && connected >= 1, "initial");
  session.sessionManager.appendMessage({ role: "user", content: "synthetic preserved history", timestamp: 1 });
  const identity = session.sessionId, history = JSON.stringify(session.sessionManager.getEntries()), oldPid = pids()[0];
  if (mode === "close-failure") {
    StdioClientTransport.prototype.close = async function () { throw Error("Synthetic transport close rejection"); };
    await assert.rejects(session.reload(), /replacement remains blocked/);
    assert.throws(() => session.prompt("must not execute"), /cleanup is unresolved/);
    await assert.rejects(session.reload(), /cleanup is unresolved/);
    assert.equal(leases.length, 1); assert.equal(leases[0].releaseCount, 0);
    assert.equal(leases[0].env().SYNTHETIC_BEARER, "synthetic-value");
    assert.deepEqual(pids(), [oldPid]);
    console.log(JSON.stringify({ mode, status: "pass", sdk: "1.0.3", externalNetwork, providerExecution: false, singleOwner: true, replacementDenied: true, promptDenied: true, scopedLeaseHeld: true }));
  } else {
    let receipt: McpShutdownReceipt | undefined;
    if (mode === 'settings-reload') {
      receipt = await acknowledgeMcpSessionsShutdown([session], new AbortController().signal);
      assert(!alive(oldPid)); assert.equal(leases[0].releaseCount, 1);
      assert.equal(leases[0].env().SYNTHETIC_BEARER, undefined);
      await hydrateMcpKeychainCredentials(root, () => ({ secret: 'replacement-synthetic-value' } as any));
      assert.equal(leases.length, 1); assert.deepEqual(pids(), []);
    }
    if (receipt) await reloadAcknowledgedMcpSessions(receipt, {}); else await session.reload();
    assert.deepEqual(extensionErrors, []); await wait(() => pids().length === 1 && pids()[0] !== oldPid && connected >= 2, "replacement");
    assert(!alive(oldPid)); assert.equal(leases[0].releaseCount, 1); assert.equal(leases.length, 2);
    assert.equal(session.sessionId, identity); assert.equal(JSON.stringify(session.sessionManager.getEntries()), history);
    if (mode === 'settings-reload') assert.equal(leases[1].env().SYNTHETIC_BEARER, 'replacement-synthetic-value');
    console.log(JSON.stringify({ mode, status: "pass", sdk: "1.0.3", externalNetwork, providerExecution: false, singleOwner: true, historyPreserved: true, oldClosedBeforeNew: true,
      ...(mode === 'settings-reload' ? { oldLeaseReleasedBeforeHydration: true, replacementCredentialGeneration: true } : {}) }));
  }
  assert.equal(externalNetwork, 0);
} finally {
  StdioClientTransport.prototype.close = originalClose;
  await runtime.dispose().catch(error => debugSuppressedError(log, "Synthetic rejected transport disposal retained.", error)); owner.dispose();
  for (const pid of pids()) { try { process.kill(pid, "SIGKILL"); } catch (error) { debugSuppressedError(log, "Synthetic MCP child already exited during fixture cleanup.", error); } }
  resetMcpStartupStateForTests();
}
