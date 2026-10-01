import { createRequire } from "node:module";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
const { MCP_RUNTIME_REGISTER_EVENT, MCP_RUNTIME_REGISTER_VERSION } = require("pi-mcp-adapter") as {
  MCP_RUNTIME_REGISTER_EVENT: string;
  MCP_RUNTIME_REGISTER_VERSION: number;
};
interface RuntimeRegistrationRequest {
  version: number;
  name: string;
  definition: unknown;
  result?: { ok: true; dispose(): Promise<void> } | { ok: false; error: Error };
}

/** Reject extension-side servers outside the immutable Piclaw bridge snapshot. */
export const mcpRuntimeRegistrationPolicy: ExtensionFactory = (pi) => {
  pi.events.on(MCP_RUNTIME_REGISTER_EVENT, (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const request = raw as RuntimeRegistrationRequest;
    if (request.result !== undefined) return;
    if (request.version !== MCP_RUNTIME_REGISTER_VERSION) {
      request.result = { ok: false, error: new Error("Unsupported MCP runtime registration version.") };
      return;
    }
    request.result = {
      ok: false,
      error: new Error(`MCP runtime registration for "${String(request.name)}" is blocked by Piclaw's immutable policy snapshot.`),
    };
  });
};
