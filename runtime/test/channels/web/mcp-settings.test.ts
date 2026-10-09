import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempWorkspaceEnv } from "../../helpers.js";
import { handleMcpSettings } from "../../../src/channels/web/handlers/mcp-settings.js";
import { handleAgentRoutes } from "../../../src/channels/web/http/dispatch-agent.js";
import { getDataRateLimitRule } from "../../../src/channels/web/http/rate-limit-rules.js";
import { hydrateMcpKeychainCredentials, resetMcpStartupStateForTests, getMcpBridgeSnapshot, getMcpBridgeReadSnapshot } from "../../../src/secure/mcp-keychain.js";
import { McpCodemodeController, resetMcpCodemodeRuntimeForTests } from "../../../src/agent-pool/mcp-codemode-runtime.js";

const owner = { kind: "local", userId: "default", username: "default", displayName: "Test", role: "admin", mode: "single-user", homeChatJid: "web:default", authentication: { method: "local", sessionId: null, expiresAt: null } };
const endpoint = "https://fixture.invalid/agent/settings/mcp";
function channel(get = () => owner as unknown) {
  const controller = new McpCodemodeController({ blockMcpAdmissions() {}, async fenceMcpAndSnapshot() { return []; }, resumeMcpAdmissions() {}, async quarantineMcpRuntime() {} });
  return { agentPool: { inspectMcpSettings: (policy?: unknown) => controller.inspect(policy), applyMcpSettings: (input: any, authorise: () => void) => controller.apply(input, authorise) }, authGateway: { getPrincipal: (_req: Request, refresh: boolean) => { expect(refresh).toBe(true); return get(); } } } as any;
}
async function call(c: any, body?: unknown, suffix = "") {
  const req = new Request(endpoint + suffix, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  return handleAgentRoutes(c, req, new URL(req.url).pathname, new URL(req.url));
}
async function fixture(run: (path: string) => Promise<void>) {
  await withTempWorkspaceEnv("mcp-settings-api-", {}, async ws => {
    resetMcpStartupStateForTests();
    resetMcpCodemodeRuntimeForTests();
    mkdirSync(join(ws.workspace, ".piclaw"), { recursive: true });
    const path = join(ws.workspace, ".piclaw/config.json");
    writeFileSync(path, JSON.stringify({ domains: { access: { mode: "single-user" } } }), { mode: 0o600 }); chmodSync(path, 0o600);
    try { await run(path); } finally { resetMcpStartupStateForTests(); resetMcpCodemodeRuntimeForTests(); }
  });
}

test("MCP read and preview routes keep persisted and runtime policy distinct, without applying", async () => fixture(async path => {
  const original = readFileSync(path, "utf8");
  const read = await call(channel()); expect(read?.status).toBe(200);
  expect(read?.headers.get("cache-control")).toBe("private, no-store");
  const state = await read!.json();
  expect(state.runtime).toEqual({ configuredFactory: "adapter", observedPolicy: { engine: "adapter", codemode: "auto" }, connectionStatus: "unknown", applyAvailable: true, phase: "ready" });
  expect(state.readiness).toEqual({ adapter: true, native: false, codemode: true });
  expect(state.persisted).toEqual({ policy: { engine: "adapter", codemode: "auto" } });
  expect(state.applyAvailable).toBe(true);
  expect(typeof state.revision).toBe("string"); expect(state.plan).not.toHaveProperty("bridgeRevision");
  for (const policy of [{ engine: "native", codemode: "auto" }]) {
    const res = await call(channel(), policy, "/preview");
    expect(res?.status).toBe(200); const body = await res!.json();
    expect(body.plan.applicable).toBe(false); expect(body.plan.issues.some((issue: any) => issue.code === "runtime_unavailable")).toBe(true);
  }
  expect(await call(channel(), { engine: "adapter", codemode: "off" }, "/preview").then(r => r!.json())).toMatchObject({ plan: { applicable: true, codemodeEnabled: false }, applyAvailable: true });
  for (const suffix of ["/save", "/preview/", "-other"]) expect(await call(channel(), {}, suffix)).toBeNull();
  expect(getDataRateLimitRule("GET", "/agent/settings/mcp")?.bucket).toBe("data/mcp_settings");
  expect(getDataRateLimitRule("POST", "/agent/settings/mcp/preview")?.bucket).toBe("data/mcp_settings");
  expect(getDataRateLimitRule("POST", "/agent/settings/mcp/apply")?.bucket).toBe("data/mcp_settings");
  expect(readFileSync(path, "utf8")).toBe(original);
}));

test("owner Apply requires acknowledgement and current revision, persists codemode and rejects native", async () => fixture(async path => {
  const c = channel();
  const preview = await call(c, {engine:"adapter",codemode:"on"}, "/preview").then(r => r!.json());
  const input = {policy:{engine:"adapter",codemode:"on"},revision:preview.revision,acknowledgeInterruptions:true};
  expect((await call(c, {...input,acknowledgeInterruptions:false}, "/apply"))?.status).toBe(400);
  expect((await call(c, {...input,revision:"stale"}, "/apply"))?.status).toBe(409);
  const applied = await call(c,input,"/apply");expect(applied?.status).toBe(200);
  expect(await applied!.json()).toMatchObject({persisted:{policy:input.policy},runtime:{observedPolicy:input.policy}});
  expect(JSON.parse(readFileSync(path,"utf8")).domains.mcp).toEqual(input.policy);
  expect((await call(c,input,"/apply"))?.status).toBe(409);
  const native = await call(c,{engine:"native",codemode:"auto"},"/preview").then(r=>r!.json());
  const denied = await call(c,{policy:native.plan.policy,revision:native.revision,acknowledgeInterruptions:true},"/apply");
  expect(denied?.status).toBe(422);expect(await denied!.text()).toContain("shutdown acknowledgement");
  expect(JSON.parse(readFileSync(path,"utf8")).domains.mcp).toEqual(input.policy);
}));

test("MCP settings denies anonymous/member/family principals before body or state access", async () => fixture(async path => {
  writeFileSync(path, "INVALID PRIVATE CONFIG");
  for (const suffix of ["/preview", "/apply"]) for (const principal of [null, { ...owner, role: "member" }, { ...owner, mode: "family-shared" }]) {
    let read = false;
    const req = new Request(endpoint + suffix, { method: "POST", body: "{}" });
    Object.defineProperty(req, "body", { get() { read = true; throw Error("must not read"); } });
    const res = await handleMcpSettings(channel(() => principal), req, new URL(req.url));
    expect(res.status).toBe(403); expect(read).toBe(false); expect(res.headers.get("cache-control")).toContain("no-store");
  }
}));

test("MCP preview validates bounded input and returns fixed diagnostics without raw values", async () => fixture(async path => {
  for (const value of [null, [], {}, { engine: "adapter", codemode: "bad" }, { engine: "adapter", codemode: "auto", token: "PRIVATE_SENTINEL" }]) {
    const response = await call(channel(), value, "/preview"); expect(response?.status).toBe(400); expect(await response!.text()).not.toContain("PRIVATE_SENTINEL");
  }
  const large = await call(channel(), { text: "x".repeat(2049) }, "/preview"); expect(large?.status).toBe(413);
  const query = await call(channel(), undefined, "?chat_jid=other"); expect(query?.status).toBe(400);
  writeFileSync(path, "INVALID PRIVATE_SENTINEL");
  const bad = await call(channel()); expect(bad?.status).toBe(503); expect(await bad!.text()).not.toContain("PRIVATE_SENTINEL");
}));

test("MCP preview rechecks fresh authority after async body and rejects aborts", async () => fixture(async () => {
  let principal: any = owner;
  let release!: () => void;
  const body = new ReadableStream<Uint8Array>({ start(controller) { release = () => { controller.enqueue(new TextEncoder().encode('{"engine":"adapter","codemode":"auto"}')); controller.close(); }; } });
  const req = new Request(endpoint + "/preview", { method: "POST", body });
  const pending = handleMcpSettings(channel(() => principal), req, new URL(req.url));
  principal = { ...owner, userId: "replacement" }; release(); expect((await pending).status).toBe(403);
  const controller = new AbortController();
  const stalled = new Request(endpoint + "/preview", { method: "POST", body: new ReadableStream(), signal: controller.signal });
  const wait = handleMcpSettings(channel(), stalled, new URL(stalled.url)); controller.abort();
  expect((await wait).status).toBe(400);
}));

test("MCP body bounds count bytes, cancel stalled readers and reject failed streams", async () => fixture(async () => {
  const policy = '{"engine":"adapter","codemode":"auto"}';
  for (const [bytes, expected] of [[2048, 200], [2049, 413]] as const) {
    const req = new Request(endpoint + "/preview", { method: "POST", body: policy + " ".repeat(bytes - policy.length) });
    expect((await handleMcpSettings(channel(), req, new URL(req.url))).status).toBe(expected);
  }
  const utf8 = new TextEncoder().encode(JSON.stringify({ engine: "adapter", codemode: "auto", x: "é".repeat(1024) }));
  const multi = new Request(endpoint + "/preview", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(utf8.slice(0, 1000)); c.enqueue(utf8.slice(1000)); c.close(); } }) });
  expect((await handleMcpSettings(channel(), multi, new URL(multi.url))).status).toBe(413);
  const broken = new Request(endpoint + "/preview", { method: "POST", body: new ReadableStream({ start(c) { c.error(Error("PRIVATE_STREAM_SENTINEL")); } }) });
  const failed = await handleMcpSettings(channel(), broken, new URL(broken.url)); expect(failed.status).toBe(400); expect(await failed.text()).not.toContain("PRIVATE_STREAM_SENTINEL");
  let cancelled = false;
  const stalled = new Request(endpoint + "/preview", { method: "POST", body: new ReadableStream({ cancel() { cancelled = true; } }) });
  expect((await handleMcpSettings(channel(), stalled, new URL(stalled.url))).status).toBe(408); expect(cancelled).toBe(true);
}), 7000);

test("MCP mode and role revocation while reading the body prevents disclosure", async () => fixture(async path => {
  for (const revoke of ["mode", "role"]) {
    writeFileSync(path, JSON.stringify({ domains: { access: { mode: "single-user" } } }));
    let principal: any = owner;
    let release!: () => void;
    const body = new ReadableStream<Uint8Array>({ start(c) { release = () => { c.enqueue(new TextEncoder().encode('{"engine":"adapter","codemode":"auto"}')); c.close(); }; } });
    const req = new Request(endpoint + "/preview", { method: "POST", body });
    const pending = handleMcpSettings(channel(() => principal), req, new URL(req.url));
    if (revoke === "mode") writeFileSync(path, JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
    else principal = { ...owner, role: "member" };
    release(); expect((await pending).status).toBe(403);
  }
}));

test("immutable bridge read snapshots cannot mutate shared config and preserve old generations", async () => fixture(async path => {
  const workspace = join(path, "../.."); mkdirSync(join(workspace, ".pi"), { recursive: true });
  writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: { first: { command: "never-run" } } }));
  await hydrateMcpKeychainCredentials(workspace, () => { throw Error("Keychain forbidden"); });
  const original = getMcpBridgeReadSnapshot();
  expect(getMcpBridgeReadSnapshot()).toBe(original);
  expect(Object.isFrozen(original.adapterConfig.mcpServers.first)).toBe(true);
  expect(Object.isFrozen(original.dryRun.rows)).toBe(true);
  expect(() => { (original.adapterConfig.mcpServers.first as any).command = "changed"; }).toThrow();
  const detached = getMcpBridgeSnapshot(); detached.adapterConfig.mcpServers.first.command = "detached";
  expect(original.adapterConfig.mcpServers.first.command).toBe("never-run");
  writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: { second: { command: "never-run-either" } } }));
  await hydrateMcpKeychainCredentials(workspace, () => { throw Error("Keychain forbidden"); });
  expect(getMcpBridgeReadSnapshot()).not.toBe(original);
  expect(Object.keys(original.adapterConfig.mcpServers)).toEqual(["first"]);
  expect(Object.keys(getMcpBridgeReadSnapshot().adapterConfig.mcpServers)).toEqual(["second"]);
}));

test("MCP settings does not expose config/source/credential details or contact servers", async () => fixture(async path => {
  const workspace = join(path, "../.."); mkdirSync(join(workspace, ".pi"), { recursive: true });
  writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: "PRIVATE_COMMAND", args: ["PRIVATE_ARGUMENT"], lifecycle: "lazy" } } }));
  await hydrateMcpKeychainCredentials(workspace, () => { throw Error("Live keychain forbidden"); });
  const response = await call(channel()); const body = await response!.json();
  expect(body.servers).toContainEqual({ name: "fixture", nativeProjectionStatus: "blocked" });
  const text = JSON.stringify(body);
  for (const privateValue of ["PRIVATE_COMMAND", "PRIVATE_ARGUMENT", workspace, "sourceRevisions", "nativePreview"]) expect(text).not.toContain(privateValue);
  expect(body.runtime.connectionStatus).toBe("unknown");
}));
