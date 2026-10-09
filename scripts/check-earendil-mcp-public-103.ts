#!/usr/bin/env bun
/** Bun-only compile admission of exact 1.0.3 public MCP seams. No runtime mocks or MCP connections. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

export const MCP_VERSION = "1.0.3";
export const MCP_GIT_HEAD = "d78dc83d633229d12f8b79631384c4c2717c399f";
export const missingSeams = [
  { symbol: "lazy", code: "TS2353", requirement: "MCP-08" },
  { symbol: "statusObserver", code: "TS2353", requirement: "MCP-12" },
  { symbol: "resourceFilter", code: "TS2353", requirement: "MCP-06" },
  { symbol: "authStart", code: "TS2353", requirement: "MCP-10" },
  { symbol: "appRenderer", code: "TS2353", requirement: "MCP-11" },
  { symbol: "absoluteDeadlineMs", code: "TS2353", requirement: "MCP-07" },
  { symbol: "McpOAuthCredentialStore", code: "TS2740", requirement: "MCP-03" },
  { symbol: "socket", code: "TS2322", requirement: "MCP-08" },
  { symbol: "listPrompts", code: "TS2339", requirement: "MCP-11" },
  { symbol: "getPrompt", code: "TS2339", requirement: "MCP-11" },
] as const;
const positive = `
import { createMcpExtension, createToolSearchExtension, createCodemodeExtension } from '@earendil-works/pi-coding-agent';
import type { McpExtensionOptions, McpTransportFactory, McpServerConfig } from '@earendil-works/pi-coding-agent';
import { McpClient, StdioTransport, StreamableHttpTransport } from '@earendil-works/pi-mcp';
import * as oauth from '@earendil-works/pi-mcp/oauth';
const factory: McpTransportFactory=()=>new StdioTransport({command:'synthetic-not-executed'});
const config:McpServerConfig={type:'http',url:'https://example.invalid/mcp',enabled:false,exposure:'deferred',toolExposure:{read:'direct',write:'hidden'}};
const options:McpExtensionOptions={loadConfig:()=>({servers:[{name:'synthetic',config,source:'fixture'}],errors:[],autoEnableCodemode:false}),createTransport:factory,updateConfig:()=>{},startupWaitMs:0,openUrl:()=>{}};
void createMcpExtension(options);void createToolSearchExtension();void createCodemodeExtension({mode:'on',models:false});void StreamableHttpTransport;
void oauth.startAuthorization;void oauth.refreshAuthorization;void oauth.MemoryOAuthStateStore;
const client=new McpClient({name:'probe',version:'0'});void client.listTools;void client.listResources;void client.listResourceTemplates;void client.readResource;void client.callTool;void client.request;void client.close;
`;
const negative = `
import type { McpExtensionOptions, McpServerConfig } from '@earendil-works/pi-coding-agent';
import { McpClient } from '@earendil-works/pi-mcp';
const lazy:McpExtensionOptions={lazy:true};
const status:McpExtensionOptions={statusObserver:()=>{}};
const resources:McpExtensionOptions={resourceFilter:()=>true};
const headless:McpExtensionOptions={authStart:async()=>({})};
const apps:McpExtensionOptions={appRenderer:()=>{}};
const deadline:McpExtensionOptions={absoluteDeadlineMs:1};
const credentials:McpExtensionOptions={credentials:{}};
const socket:McpServerConfig={type:'socket',socket:'/tmp/mcp.sock'};
const client=new McpClient({name:'probe',version:'0'});client.listPrompts();client.getPrompt('name');
void lazy;void status;void resources;void headless;void apps;void deadline;void credentials;void socket;
`;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function matchNegativeDiagnostics(text: string) {
  const rows = [...text.matchAll(/error (TS\d+): ([^\n]+)/g)].map(match => ({ code: match[1]!, message: match[2]! }));
  if (rows.length !== missingSeams.length) throw new Error(`Expected exactly ${missingSeams.length} public seam diagnostics; got ${rows.length}.`);
  const used = new Set<number>();
  for (const expected of missingSeams) {
    const indexes = rows.flatMap((row, index) => row.code === expected.code && row.message.includes(expected.symbol) ? [index] : []);
    if (indexes.length !== 1 || used.has(indexes[0]!)) throw new Error(`Missing or ambiguous ${expected.code} for ${expected.symbol}.`);
    used.add(indexes[0]!);
  }
  return missingSeams.map(row => ({ ...row }));
}

export function checkMcpPublic103(repoRoot = resolve(import.meta.dir, "..")) {
  if (!process.versions.bun) throw new Error("Bun execution is required.");
  const root = resolve(repoRoot);
  const packages = ["pi-coding-agent", "pi-mcp", "pi-codemode"].map(name => {
    const file = join(root, "node_modules/@earendil-works", name, "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    if (pkg.version !== MCP_VERSION) throw new Error(`Exact ${MCP_VERSION} required for ${name}.`);
    return { name: pkg.name as string, version: pkg.version as string };
  });
  const scratch = mkdtempSync(join(tmpdir(), "mcp-api-103-"));
  try {
    symlinkSync(join(root, "node_modules"), join(scratch, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const compile = (name: string, source: string) => {
      writeFileSync(join(scratch, name + ".ts"), source);
      writeFileSync(join(scratch, name + ".json"), JSON.stringify({ compilerOptions: { target: "ES2024", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: true }, files: [name + ".ts"] }));
      const child = Bun.spawnSync([process.execPath, join(root, "node_modules/typescript/bin/tsc"), "--pretty", "false", "-p", join(scratch, name + ".json")], { cwd: scratch, env: { PATH: process.env.PATH, HOME: scratch }, stdout: "pipe", stderr: "pipe", timeout: 30000 });
      if (child.signalCode) throw new Error(`Compiler did not settle normally: ${name}.`);
      return { exit: child.exitCode, text: child.stdout.toString() + child.stderr.toString() };
    };
    const supported = compile("positive", positive);
    if (supported.exit !== 0) throw new Error(`Public MCP positive compile failed: ${supported.text}`);
    const unsupported = compile("negative", negative);
    if (unsupported.exit !== 1 && unsupported.exit !== 2) throw new Error(`Negative compile must exit with diagnostics, got ${unsupported.exit}: ${unsupported.text}`);
    const diagnostics = matchNegativeDiagnostics(unsupported.text);
    return { version: MCP_VERSION, referenceGitHead: MCP_GIT_HEAD, archiveIntegrity: "not_remeasured_by_compile_probe", runtime: `Bun ${Bun.version}`, packages, positive: "pass", negative: diagnostics,
      positiveSourceSha256: digest(positive), negativeSourceSha256: digest(negative),
      scope: "public_type_contract_only", lifecycle: "separate_real_session_fixture", nativeParity: "not_qualified", productionActivation: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (import.meta.main) console.log(JSON.stringify(checkMcpPublic103(), null, 2));
