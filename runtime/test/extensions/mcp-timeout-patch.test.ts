import { afterEach, describe, expect, test } from "bun:test";

import { getMcpToolTimeoutMs, mcpTimeoutPatch } from "../../src/extensions/mcp-timeout-patch.js";

function createPatchHarness() {
  const handlers: Array<{ event: string; handler: (...args: any[]) => any }> = [];
  const api = {
    on(event: string, handler: (...args: any[]) => any) {
      handlers.push({ event, handler });
    },
  } as any;
  mcpTimeoutPatch(api);
  return { handlers };
}

describe("mcp-timeout-patch configuration", () => {
  const previous = process.env.PICLAW_MCP_TOOL_TIMEOUT_MS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.PICLAW_MCP_TOOL_TIMEOUT_MS;
    } else {
      process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = previous;
    }
  });

  test("defaults to the built-in two-minute timeout", () => {
    delete process.env.PICLAW_MCP_TOOL_TIMEOUT_MS;
    expect(getMcpToolTimeoutMs()).toBe(120_000);
  });

  test("honors a positive timeout override", () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = "60000";
    expect(getMcpToolTimeoutMs()).toBe(60_000);
  });

  test("treats zero as timeout disabled", () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = "0";
    expect(getMcpToolTimeoutMs()).toBeNull();
  });

  test("falls back to the default for invalid or negative values", () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = "not-a-number";
    expect(getMcpToolTimeoutMs()).toBe(120_000);

    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = "0abc";
    expect(getMcpToolTimeoutMs()).toBe(120_000);

    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = "-1";
    expect(getMcpToolTimeoutMs()).toBe(120_000);
  });

  test("does not install a session_start hook when the wrapper timeout is disabled", () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = "0";
    const { handlers } = createPatchHarness();
    expect(handlers).toEqual([]);
  });

  test("wraps MCP tools but leaves unrelated tools untouched", async () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = "5000";
    const { handlers } = createPatchHarness();
    expect(handlers.map((entry) => entry.event)).toEqual(["session_start"]);

    const originalMcpExecute = async (...args: unknown[]) => ({ args });
    const originalRegularExecute = async () => "ok";
    const mcpTool = { name: "mcp_echo", execute: originalMcpExecute };
    const directMcpTool = { name: "workiq_retrieve", label: "MCP: retrieve", execute: originalMcpExecute };
    const scriptTool = { name: "mcpScript", execute: originalMcpExecute };
    const namespaceTool = { name: "mcp__workiq", execute: originalMcpExecute };
    const regularTool = { name: "bash", execute: originalRegularExecute };

    await handlers[0].handler({}, { _agent: { tools: [mcpTool, directMcpTool, scriptTool, namespaceTool, regularTool] } });

    expect(mcpTool.execute).not.toBe(originalMcpExecute);
    expect(directMcpTool.execute).not.toBe(originalMcpExecute);
    expect(scriptTool.execute).not.toBe(originalMcpExecute);
    expect(namespaceTool.execute).not.toBe(originalMcpExecute);
    expect(regularTool.execute).toBe(originalRegularExecute);
    await expect(mcpTool.execute("call-1", { tool: "echo" }, undefined, "rest")).resolves.toEqual({
      args: ["call-1", { tool: "echo" }, expect.any(AbortSignal), "rest"],
    });
  });

  test("patched MCP tools reject when their abort signal fires", async () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = "5000";
    const { handlers } = createPatchHarness();
    let operationSignal: AbortSignal | undefined;
    const mcpTool = {
      name: "mcp",
      execute: async (_id: unknown, _params: unknown, signal: AbortSignal) => { operationSignal = signal; return new Promise(() => {}); },
    };
    await handlers[0].handler({}, { _agent: { tools: [mcpTool] } });

    const controller = new AbortController();
    const call = mcpTool.execute("call-1", { tool: "slow", server: "test" }, controller.signal);
    controller.abort();

    await expect(call).rejects.toThrow("MCP tool call aborted: mcp → slow (test)");
    expect(operationSignal?.aborted).toBe(true);
  });

  test("already-aborted callers never start the underlying operation", async () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS="5000";const {handlers}=createPatchHarness();let calls=0;
    const tool={name:"mcp",execute:async()=>{calls++;return "unreachable";}};await handlers[0].handler({}, {_agent:{tools:[tool]}});
    const controller=new AbortController();controller.abort();await expect(tool.execute("call",{},controller.signal)).rejects.toThrow("aborted");expect(calls).toBe(0);
  });

  test("successful calls remove caller listeners and repeated binding does not double-wrap", async () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS="5000";const {handlers}=createPatchHarness();let calls=0,adds=0,removes=0;
    const tool={name:"mcp",execute:async()=>{calls++;return "ok";}};await handlers[0].handler({}, {_agent:{tools:[tool]}});const once=tool.execute;await handlers[0].handler({}, {_agent:{tools:[tool]}});expect(tool.execute).toBe(once);
    const controller=new AbortController(),add=controller.signal.addEventListener.bind(controller.signal),remove=controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener=((...args:any[])=>{adds++;return add(...args as Parameters<typeof add>);}) as any;
    controller.signal.removeEventListener=((...args:any[])=>{removes++;return remove(...args as Parameters<typeof remove>);}) as any;
    await expect(tool.execute("call",{},controller.signal)).resolves.toBe("ok");expect(calls).toBe(1);expect([adds,removes]).toEqual([1,1]);
  });

  test("deadline abort reaches underlying cleanup and late settlement stays suppressed", async () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS="10";const {handlers}=createPatchHarness();let release!:()=>void,cleaned=false;
    const held=new Promise<void>(resolve=>release=resolve);const tool={name:"mcp",execute:async(_id:unknown,_params:unknown,signal:AbortSignal)=>{signal.addEventListener("abort",()=>{cleaned=true;},{once:true});await held;return "late";}};
    await handlers[0].handler({}, {_agent:{tools:[tool]}});const result=tool.execute("call",{},undefined);await expect(result).rejects.toThrow("timed out");expect(cleaned).toBe(true);release();await Bun.sleep(1);
  });

  test("patched MCP tools reject when the wrapper timeout expires", async () => {
    process.env.PICLAW_MCP_TOOL_TIMEOUT_MS = "10";
    const { handlers } = createPatchHarness();
    let operationSignal: AbortSignal | undefined;
    const mcpTool = {
      name: "mcp_slow",
      execute: async (_id: unknown, _params: unknown, signal: AbortSignal) => { operationSignal = signal; return new Promise(() => {}); },
    };
    await handlers[0].handler({}, { _agent: { tools: [mcpTool] } });

    await expect(mcpTool.execute("call-1", {}, undefined)).rejects.toThrow("MCP tool call timed out after 0s: mcp_slow");
    expect(operationSignal?.aborted).toBe(true);
  });
});
