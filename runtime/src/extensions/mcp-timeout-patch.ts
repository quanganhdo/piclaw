/** Piclaw absolute MCP operation deadline layered over adapter inactivity timeouts. */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { getToolsIntegrationConfig } from "../core/config.js";

export function getMcpToolTimeoutMs(): number | null {
  const timeoutMs = getToolsIntegrationConfig().mcpToolTimeoutMs;
  return timeoutMs === 0 ? null : timeoutMs;
}

function runWithAbsoluteDeadline<T>(
  start: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const operation = new AbortController();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      callback();
    };
    const timeoutError = () => new Error(`MCP tool call timed out after ${Math.round(timeoutMs / 1000)}s: ${label}`);
    const timer = setTimeout(() => {
      const error = timeoutError();
      operation.abort(error);
      finish(() => reject(error));
    }, timeoutMs);
    const onCallerAbort = () => {
      const error = new Error(`MCP tool call aborted: ${label}`);
      operation.abort(callerSignal?.reason ?? error);
      finish(() => reject(error));
    };
    if (callerSignal?.aborted) { onCallerAbort(); return; }
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    let pending: Promise<T>;
    try { pending = start(operation.signal); }
    catch (error) { finish(() => reject(error)); return; }
    pending.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

function isMcpTool(tool: { name?: unknown; label?: unknown }): boolean {
  return typeof tool.name === "string" && (
    tool.name === "mcp" || tool.name === "mcpScript" || tool.name.startsWith("mcp_") || tool.name.startsWith("mcp__")
    || (typeof tool.label === "string" && tool.label.startsWith("MCP:"))
  );
}
function getMcpCallLabel(toolName: string, params: unknown): string {
  if (toolName === "mcp" && params && typeof params === "object") {
    const p = params as Record<string, unknown>;
    if (p.tool) return `mcp → ${p.tool}${p.server ? ` (${p.server})` : ""}`;
    if (p.connect) return `mcp connect → ${p.connect}`;
    if (p.describe) return `mcp describe → ${p.describe}`;
    if (p.search) return `mcp search → ${p.search}`;
    return "mcp (status)";
  }
  return toolName;
}

const patched = new WeakSet<object>();
export const mcpTimeoutPatch: ExtensionFactory = (pi: ExtensionAPI): void => {
  const timeoutMs = getMcpToolTimeoutMs();
  if (timeoutMs === null) return;
  pi.on("session_start", async (_event, ctx) => {
    await new Promise(resolve => setTimeout(resolve, 0));
    const tools = (ctx as unknown as { _agent?: { tools?: Array<{ name: string; label?: string; execute: (...args: any[]) => Promise<unknown> }> } })._agent?.tools;
    if (!Array.isArray(tools)) return;
    for (const tool of tools) {
      if (!isMcpTool(tool) || typeof tool.execute !== "function" || patched.has(tool)) continue;
      patched.add(tool);
      const originalExecute = tool.execute.bind(tool);
      tool.execute = async function patchedMcpExecute(toolCallId: unknown, params: unknown, callerSignal: AbortSignal | undefined, ...rest: unknown[]) {
        const label = getMcpCallLabel(tool.name, params);
        return runWithAbsoluteDeadline(
          operationSignal => originalExecute(toolCallId, params, operationSignal, ...rest),
          timeoutMs,
          callerSignal,
          label,
        );
      };
    }
  });
};
