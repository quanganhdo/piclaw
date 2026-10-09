import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireMcpSessionBridge,
  clearHydratedMcpCredentials,
  createMcpConfigWriteAuthority,
  getMcpBridgeDryRun,
  getMcpBridgeSnapshot,
  getMcpStartupDiagnostics,
  getPreparedMcpConfig,
  hydrateMcpKeychainCredentials,
  resetMcpStartupStateForTests,
  writeMcpProjectOverride,
} from "../../src/secure/mcp-keychain.js";

const touched = new Map<string, string | undefined>();

function isolateEnv(name: string): void {
  if (!touched.has(name)) touched.set(name, process.env[name]);
  delete process.env[name];
}

function setTestEnv(name: string, value: string): void {
  if (!touched.has(name)) touched.set(name, process.env[name]);
  process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of touched) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  touched.clear();
  resetMcpStartupStateForTests();
});

function workspace(config: object): string {
  const root = mkdtempSync(join(tmpdir(), "piclaw-mcp-keychain-"));
  mkdirSync(join(root, ".pi"), { recursive: true });
  writeFileSync(join(root, ".pi", "mcp.json"), JSON.stringify(config));
  return root;
}

const resolveEntry = async (name: string) => ({
  name,
  type: "token" as const,
  secret: "secret-value",
  username: null,
});

describe("MCP keychain credential hydration", () => {
  test("hydrates workspace config without changing the process working directory", async () => {
    const originalCwd = process.cwd();
    const root = workspace({
      mcpServers: {
        memento: {
          url: "http://example.test/mcp",
          bearerTokenKeychain: "memento/example",
          bearerTokenEnv: "PICLAW_MCP_MEMENTO_TOKEN",
        },
      },
    });
    isolateEnv("PICLAW_MCP_MEMENTO_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(root, resolveEntry);
    expect(process.cwd()).toBe(originalCwd);
    expect(getPreparedMcpConfig().mcpServers.memento).toMatchObject({
      url: "http://example.test/mcp",
      bearerTokenEnv: "PICLAW_MCP_MEMENTO_TOKEN",
    });
    expect(process.env.PICLAW_MCP_MEMENTO_TOKEN).toBeUndefined();
    const lease=acquireMcpSessionBridge();
    expect(lease.resolveRuntimeEnv("memento").PICLAW_MCP_MEMENTO_TOKEN).toBe("secret-value");
    expect(getMcpBridgeDryRun().secretValuesPresent).toBe(false);
    lease.release();
    expect(entries).toEqual([
      {
        serverName: "memento",
        envName: "PICLAW_MCP_MEMENTO_TOKEN",
        keychainName: "memento/example",
      },
    ]);
    clearHydratedMcpCredentials(entries);
    expect(process.env.PICLAW_MCP_MEMENTO_TOKEN).toBeUndefined();
  });

  test("quarantines malformed optional servers while hydrating valid servers", async () => {
    isolateEnv("PICLAW_MCP_VALID_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          valid: {
            url: "http://valid.example.test/mcp",
            bearerTokenKeychain: "valid/token",
            bearerTokenEnv: "PICLAW_MCP_VALID_TOKEN",
          },
          missingEnv: {
            url: "http://missing-env.example.test/mcp",
            bearerTokenKeychain: "missing-env/token",
          },
          conflicting: {
            url: "http://conflicting.example.test/mcp",
            bearerToken: "literal",
            bearerTokenKeychain: "conflicting/token",
            bearerTokenEnv: "PICLAW_MCP_CONFLICTING_TOKEN",
          },
        },
      }),
      resolveEntry,
    );

    expect(entries).toEqual([{ serverName: "valid", envName: "PICLAW_MCP_VALID_TOKEN", keychainName: "valid/token" }]);
    expect(process.env.PICLAW_MCP_VALID_TOKEN).toBeUndefined();
    const lease=acquireMcpSessionBridge();
    expect(lease.resolveRuntimeEnv("valid").PICLAW_MCP_VALID_TOKEN).toBe("secret-value");
    lease.release();
    expect(getPreparedMcpConfig().mcpServers).toMatchObject({
      valid: { bearerTokenEnv: "PICLAW_MCP_VALID_TOKEN" },
      missingEnv: { disabled: true },
      conflicting: { disabled: true },
    });
    expect(getMcpStartupDiagnostics()).toEqual([
      { serverName: "missingEnv", reason: "bearerTokenKeychain requires a valid bearerTokenEnv." },
      { serverName: "conflicting", reason: "literal bearerToken is forbidden; use a supported environment/command reference or keychain." },
    ]);
    clearHydratedMcpCredentials(entries);
  });

  test("quarantines duplicate keychain environment targets without overwriting the first server", async () => {
    isolateEnv("PICLAW_MCP_SHARED_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          first: { command: "node", bearerTokenKeychain: "first/token", bearerTokenEnv: "PICLAW_MCP_SHARED_TOKEN" },
          second: { command: "node", bearerTokenKeychain: "second/token", bearerTokenEnv: "PICLAW_MCP_SHARED_TOKEN" },
        },
      }),
      resolveEntry,
    );
    expect(entries).toEqual([{ serverName: "first", envName: "PICLAW_MCP_SHARED_TOKEN", keychainName: "first/token" }]);
    expect(process.env.PICLAW_MCP_SHARED_TOKEN).toBeUndefined();
    const lease=acquireMcpSessionBridge();
    expect(lease.resolveRuntimeEnv("first").PICLAW_MCP_SHARED_TOKEN).toBe("secret-value");
    expect(lease.resolveRuntimeEnv("second").PICLAW_MCP_SHARED_TOKEN).toBeUndefined();
    lease.release();
    expect(getPreparedMcpConfig().mcpServers.second).toMatchObject({ disabled: true });
    expect(getMcpStartupDiagnostics()).toEqual([
      { serverName: "second", reason: "bearerTokenEnv PICLAW_MCP_SHARED_TOKEN is already claimed by another MCP server." },
    ]);
    clearHydratedMcpCredentials(entries);
  });

  test("quarantines missing keychain entries without clearing valid credentials", async () => {
    isolateEnv("PICLAW_MCP_VALID_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          valid: {
            command: "node",
            bearerTokenKeychain: "valid/token",
            bearerTokenEnv: "PICLAW_MCP_VALID_TOKEN",
          },
          unavailable: {
            command: "node",
            bearerTokenKeychain: "missing/token",
            bearerTokenEnv: "PICLAW_MCP_UNAVAILABLE_TOKEN",
          },
        },
      }),
      async (name) => name === "missing/token"
        ? { name, type: "token", secret: null, username: null }
        : resolveEntry(name),
    );

    expect(entries).toEqual([{ serverName: "valid", envName: "PICLAW_MCP_VALID_TOKEN", keychainName: "valid/token" }]);
    expect(getPreparedMcpConfig().mcpServers.unavailable).toMatchObject({ disabled: true });
    expect(getMcpStartupDiagnostics()).toEqual([
      { serverName: "unavailable", reason: "keychain entry is unavailable or has no secret." },
    ]);
    clearHydratedMcpCredentials(entries);
  });

  test("quarantines ambiguous or unsafe credential configuration", async () => {
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          conflicting: {
            bearerToken: "literal",
            bearerTokenKeychain: "memento/example",
            bearerTokenEnv: "PICLAW_MCP_TOKEN",
          },
          missingEnv: { bearerTokenKeychain: "memento/example" },
        },
      }),
      resolveEntry,
    );
    expect(entries).toEqual([]);
    expect(getPreparedMcpConfig().mcpServers).toMatchObject({
      conflicting: { disabled: true },
      missingEnv: { disabled: true },
    });
  });

  test("validates supported adapter environment references after keychain hydration", async () => {
    setTestEnv("PICLAW_MCP_EXISTING", "existing");
    setTestEnv("SHELL_OWNS_THIS", "shell-owned");
    isolateEnv("PICLAW_MCP_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          local: {
            command: "bun",
            args: ["server.ts", "$PLAIN_VAR"],
            cwd: "${PICLAW_MCP_EXISTING}",
            env: {
              FROM_BRACES: "${PICLAW_MCP_TOKEN}",
              FROM_ENV_PREFIX: "$env:PICLAW_MCP_EXISTING",
              FROM_ADAPTER_FORM: "{env:PICLAW_MCP_EXISTING}",
              PLAIN_LITERAL: "$PLAIN_VAR",
              ESCAPED_COMMAND: "!!${PICLAW_MCP_EXISTING}",
              COMMAND_SECRET: "!printf '$SHELL_OWNS_THIS'",
            },
            bearerTokenKeychain: "memento/example",
            bearerTokenEnv: "PICLAW_MCP_TOKEN",
          },
        },
      }),
      resolveEntry,
    );
    expect(process.env.PICLAW_MCP_TOKEN).toBeUndefined();
    const lease=acquireMcpSessionBridge();
    expect(lease.resolveRuntimeEnv("local").PICLAW_MCP_TOKEN).toBe("secret-value");
    lease.release();
    clearHydratedMcpCredentials(entries);
  });

  test("forces server sampling and elicitation off until an authorized budget policy exists", async () => {
    await hydrateMcpKeychainCredentials(workspace({settings:{sampling:true,samplingAutoApprove:true,elicitation:true},mcpServers:{demo:{command:"node"}}}),resolveEntry);
    expect(getPreparedMcpConfig().settings).toMatchObject({sampling:false,samplingAutoApprove:false,elicitation:false});
  });

  test("preserves supported non-keychain bearer and command references in the scoped environment", async () => {
    setTestEnv("PICLAW_MCP_EXTERNAL_TOKEN","external-token");setTestEnv("COMMAND_VALUE","command-value");
    await hydrateMcpKeychainCredentials(workspace({mcpServers:{
      external:{url:"https://example.test/mcp",auth:"bearer",bearerToken:"${PICLAW_MCP_EXTERNAL_TOKEN}"},
      command:{command:"node",env:{SECRET:"!printf '$COMMAND_VALUE'"}},
    }}),resolveEntry);
    const lease=acquireMcpSessionBridge();
    expect(getPreparedMcpConfig().mcpServers.external).toMatchObject({bearerToken:"${PICLAW_MCP_EXTERNAL_TOKEN}"});
    expect(lease.resolveRuntimeEnv("external").PICLAW_MCP_EXTERNAL_TOKEN).toBe("external-token");
    expect(lease.resolveRuntimeEnv("command").COMMAND_VALUE).toBe("command-value");lease.release();
  });

  test("quarantines malformed nested command arguments without aborting other servers", async () => {
    await hydrateMcpKeychainCredentials(workspace({mcpServers:{bad:{url:"https://example.test",requestHeadersCommand:{command:"helper",args:7}},good:{command:"node"}}}),resolveEntry);
    expect(getPreparedMcpConfig().mcpServers.bad).toMatchObject({disabled:true});expect(getPreparedMcpConfig().mcpServers.good).toMatchObject({command:"node"});
    expect(getMcpStartupDiagnostics().some(item=>item.serverName==="bad"&&item.reason.includes("args"))).toBe(true);
  });

  test("quarantines unresolved stdio, header, URL, and token references", async () => {
    isolateEnv("PICLAW_MCP_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          local: {
            url: "https://example.test/${PICLAW_MCP_MISSING_URL}",
            env: { TOKEN: "$env:PICLAW_MCP_MISSING_ENV" },
            headers: { Authorization: "Bearer {env:PICLAW_MCP_MISSING_HEADER}" },
            bearerTokenKeychain: "memento/example",
            bearerTokenEnv: "PICLAW_MCP_TOKEN",
          },
        },
      }),
      resolveEntry,
    );
    expect(entries).toEqual([]);
    expect(process.env.PICLAW_MCP_TOKEN).toBeUndefined();
    expect(getPreparedMcpConfig().mcpServers.local).toMatchObject({ disabled: true });
    expect(getMcpStartupDiagnostics()[0]?.reason).toContain("references missing environment variable");
  });

  test("keeps secret values out of snapshots and classifies native mapping honestly", async () => {
    isolateEnv("PICLAW_MCP_VALID_TOKEN");
    const sentinel="secret-sentinel-never-persist";
    await hydrateMcpKeychainCredentials(workspace({mcpServers:{
      native:{command:"node",args:["server.mjs"]},
      blocked:{url:"https://example.test/mcp",lifecycle:"lazy",bearerTokenKeychain:"valid/token",bearerTokenEnv:"PICLAW_MCP_VALID_TOKEN"},
      unknown:{command:"node",unsupportedSemantic:true},
    }}),async name=>({name,type:"token",secret:sentinel,username:null}));
    const snapshot=getMcpBridgeSnapshot(),dryRun=getMcpBridgeDryRun();
    expect(dryRun.rows.map(row=>[row.serverName,row.status])).toEqual([["blocked","blocked"],["native","mapped"],["unknown","quarantined"]]);
    expect(snapshot.nativePreview.servers.map(server=>server.name)).toEqual(["native"]);
    expect(JSON.stringify({snapshot,dryRun,config:getPreparedMcpConfig()})).not.toContain(sentinel);
    expect(getPreparedMcpConfig().mcpServers.unknown).toMatchObject({disabled:true});
  });

  test("creates tombstones for malformed high-precedence overrides", async () => {
    const root=mkdtempSync(join(tmpdir(),"piclaw-mcp-tombstone-"));mkdirSync(join(root,".pi"),{recursive:true});
    writeFileSync(join(root,".mcp.json"),JSON.stringify({mcpServers:{shared:{command:"lower"},other:{command:"safe"}}}));
    writeFileSync(join(root,".pi","mcp.json"),JSON.stringify({mcpServers:{shared:null}}));
    await hydrateMcpKeychainCredentials(root,resolveEntry);
    expect(getPreparedMcpConfig().mcpServers.shared).toMatchObject({disabled:true});
    expect(getPreparedMcpConfig().mcpServers.other).toMatchObject({command:"safe"});
    expect(getMcpStartupDiagnostics().some(item=>item.serverName==="shared"&&item.reason.includes("higher-precedence"))).toBe(true);
    writeFileSync(join(root,".pi","mcp.json"),"{ malformed");
    await hydrateMcpKeychainCredentials(root,resolveEntry);
    expect(Object.values(getPreparedMcpConfig().mcpServers).every(server=>server.disabled===true)).toBe(true);
  });

  test("redacts literal header and OAuth secrets even from quarantined snapshots", async () => {
    const sentinel="plaintext-secret-sentinel";
    await hydrateMcpKeychainCredentials(workspace({mcpServers:{bad:{url:"https://example.test/mcp",headers:{Authorization:`Bearer ${sentinel}`},oauth:{clientId:"id",clientSecret:sentinel}}}}),resolveEntry);
    const serialized=JSON.stringify({snapshot:getMcpBridgeSnapshot(),config:getPreparedMcpConfig(),dryRun:getMcpBridgeDryRun()});
    expect(serialized).not.toContain(sentinel);expect(getPreparedMcpConfig().mcpServers.bad).toMatchObject({disabled:true});
  });

  test("retains scoped secrets until the final lease releases, then clears them", async () => {
    isolateEnv("PICLAW_MCP_LEASE_TOKEN");
    const entries=await hydrateMcpKeychainCredentials(workspace({mcpServers:{demo:{command:"node",bearerTokenKeychain:"lease/token",bearerTokenEnv:"PICLAW_MCP_LEASE_TOKEN"}}}),async name=>({name,type:"token",secret:"lease-secret",username:null}));
    const first=acquireMcpSessionBridge(),second=acquireMcpSessionBridge();
    clearHydratedMcpCredentials(entries);first.release();
    expect(second.resolveRuntimeEnv("demo").PICLAW_MCP_LEASE_TOKEN).toBe("lease-secret");
    second.release();
    expect(()=>acquireMcpSessionBridge()).toThrow("retired");
  });

  test("prevents an older concurrent hydration from replacing a newer generation", async () => {
    isolateEnv("PICLAW_MCP_RACE_TOKEN");const root=workspace({mcpServers:{demo:{command:"node",bearerTokenKeychain:"race/token",bearerTokenEnv:"PICLAW_MCP_RACE_TOKEN"}}});
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const older=hydrateMcpKeychainCredentials(root,async name=>{await gate;return{name,type:"token",secret:"old-secret",username:null};});
    await Bun.sleep(1);await hydrateMcpKeychainCredentials(root,async name=>({name,type:"token",secret:"new-secret",username:null}));release();
    await expect(older).rejects.toThrow("superseded");const lease=acquireMcpSessionBridge();expect(lease.resolveRuntimeEnv("demo").PICLAW_MCP_RACE_TOKEN).toBe("new-secret");lease.release();
  });

  test("retires secret generations independently across reloads", async () => {
    isolateEnv("PICLAW_MCP_GENERATION_TOKEN");
    const root=workspace({mcpServers:{demo:{command:"node",bearerTokenKeychain:"generation/token",bearerTokenEnv:"PICLAW_MCP_GENERATION_TOKEN"}}});
    await hydrateMcpKeychainCredentials(root,async name=>({name,type:"token",secret:"first-secret",username:null}));
    const oldLease=acquireMcpSessionBridge();
    await hydrateMcpKeychainCredentials(root,async name=>({name,type:"token",secret:"second-secret",username:null}));
    const newLease=acquireMcpSessionBridge();
    expect(oldLease.resolveRuntimeEnv("demo").PICLAW_MCP_GENERATION_TOKEN).toBe("first-secret");
    expect(newLease.resolveRuntimeEnv("demo").PICLAW_MCP_GENERATION_TOKEN).toBe("second-secret");
    oldLease.release();expect(oldLease.resolveRuntimeEnv("demo").PICLAW_MCP_GENERATION_TOKEN).toBeUndefined();newLease.release();
  });

  test("writes project overrides atomically with authorization and revision checks", async () => {
    const root=workspace({mcpServers:{}});await hydrateMcpKeychainCredentials(root,resolveEntry);
    const authority=createMcpConfigWriteAuthority({workspaceDir:root,authorise:()=>{},signal:new AbortController().signal}),initial=getMcpBridgeSnapshot().revision;
    const written=await writeMcpProjectOverride({workspaceDir:root,expectedRevision:initial,config:{mcpServers:{demo:{command:"node"}}},authority});
    expect(JSON.parse(readFileSync(written.path,"utf8"))).toEqual({mcpServers:{demo:{command:"node"}}});
    expect(written.committed).toBe(true);expect(getPreparedMcpConfig().mcpServers.demo).toBeUndefined();
    await hydrateMcpKeychainCredentials(root,resolveEntry);const revision=getMcpBridgeSnapshot().revision;
    expect(revision).not.toBe(initial);expect(getPreparedMcpConfig().mcpServers.demo).toMatchObject({command:"node"});
    await expect(writeMcpProjectOverride({workspaceDir:root,expectedRevision:initial,config:{mcpServers:{}},authority})).rejects.toThrow("revision conflict");
    await expect(writeMcpProjectOverride({workspaceDir:root,expectedRevision:revision,config:{mcpServers:{ambiguous:{command:"node",url:"https://example.test"}}},authority})).rejects.toThrow("exactly one");
    await expect(writeMcpProjectOverride({workspaceDir:root,expectedRevision:revision,config:{mcpServers:{secret:{url:"https://example.test",headers:{Authorization:"literal-secret"}}}},authority})).rejects.toThrow("literal secret");
    writeFileSync(written.path,JSON.stringify({mcpServers:{external:{command:"node"}}}));
    await expect(writeMcpProjectOverride({workspaceDir:root,expectedRevision:revision,config:{mcpServers:{}},authority})).rejects.toThrow("revision conflict");
    await expect(writeMcpProjectOverride({workspaceDir:root,expectedRevision:revision,config:{mcpServers:{}},authority:{} as any})).rejects.toThrow("not authorized");
    const shared=join(root,".mcp.json");writeFileSync(shared,JSON.stringify({mcpServers:{changed:{command:"node"}}}));
    await expect(writeMcpProjectOverride({workspaceDir:root,expectedRevision:revision,config:{mcpServers:{}},authority})).rejects.toThrow("revision conflict");
  });

  test("does not overwrite an existing environment variable", async () => {
    setTestEnv("PICLAW_MCP_TOKEN", "existing");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          memento: {
            bearerTokenKeychain: "memento/example",
            bearerTokenEnv: "PICLAW_MCP_TOKEN",
          },
        },
      }),
      resolveEntry,
    );
    expect(entries).toEqual([]);
    expect(process.env.PICLAW_MCP_TOKEN).toBe("existing");
    expect(getPreparedMcpConfig().mcpServers.memento).toMatchObject({ disabled: true });
  });
});
