import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getPreparedMcpConfig } from "../../../secure/mcp-keychain.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import type { ParsedQmdReference } from "./qmd-reference.js";

const log = createLogger("web.qmd-document");

const require = createRequire(import.meta.url);
const adapterRoot = dirname(require.resolve("pi-mcp-adapter"));
const {
  resolveBearerToken,
  resolveCommandSecret,
  resolveCommandSecretsRecord,
  resolveServerUrl,
} = require(join(adapterRoot, "utils.ts")) as {
  resolveBearerToken(definition: QmdServerDefinition): string | undefined;
  resolveCommandSecret(value: string, label: string): string;
  resolveCommandSecretsRecord(values: Record<string, string> | undefined, label: (key: string) => string): Record<string, string> | undefined;
  resolveServerUrl(definition: QmdServerDefinition): string | undefined;
};

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

interface QmdServerDefinition {
  disabled?: unknown;
  url?: unknown;
  auth?: unknown;
  headers?: Record<string, string>;
  bearerToken?: string;
  bearerTokenEnv?: string;
  bearerTokenKeychain?: string;
}

interface ResolvedQmdServer {
  url: URL;
  requestInit?: RequestInit;
}

export class QmdDocumentError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "QmdDocumentError";
  }
}

function configuredQmdServer(): ResolvedQmdServer {
  const config = getPreparedMcpConfig() as {
    mcpServers?: Record<string, QmdServerDefinition | undefined>;
  };
  const definition = config.mcpServers?.qmd;
  if (!definition || definition.disabled === true) {
    throw new QmdDocumentError(503, "The QMD MCP server is not configured or is disabled.");
  }
  if (definition.auth === "oauth") {
    throw new QmdDocumentError(503, "The QMD document viewer does not support OAuth MCP configuration.");
  }

  try {
    const rawUrl = resolveServerUrl(definition);
    if (!rawUrl) throw new Error("missing URL");
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported transport");

    const hasCommandHeader = Object.values(definition.headers ?? {})
      .some((value) => value.startsWith("!") && !value.startsWith("!!"));
    const headers = resolveCommandSecretsRecord(
      definition.headers,
      (key) => `MCP server \"qmd\" HTTP header \"${key}\"`,
    ) ?? {};
    const commandBearer = definition.bearerToken?.startsWith("!") && !definition.bearerToken.startsWith("!!")
      ? definition.bearerToken
      : undefined;
    if (definition.auth === "bearer") {
      const token = commandBearer
        ? resolveCommandSecret(commandBearer, "MCP server \"qmd\" HTTP bearer token")
        : resolveBearerToken(definition);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (hasCommandHeader || commandBearer || Object.keys(headers).length > 0) new Headers(headers);
    return {
      url,
      requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
    };
  } catch {
    throw new QmdDocumentError(503, "The QMD MCP server configuration is invalid.");
  }
}

function extractText(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new QmdDocumentError(502, "QMD returned an invalid document response.");
  }
  const record = result as {
    isError?: unknown;
    content?: unknown;
    structuredContent?: unknown;
  };
  if (record.isError === true) {
    throw new QmdDocumentError(404, "QMD document not found.");
  }

  const parts: string[] = [];
  if (Array.isArray(record.content)) {
    for (const entry of record.content) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as { type?: unknown; text?: unknown; resource?: { text?: unknown } };
      if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
      if (item.type === "resource" && typeof item.resource?.text === "string") parts.push(item.resource.text);
    }
  }
  if (parts.length === 0 && record.structuredContent && typeof record.structuredContent === "object") {
    const structured = record.structuredContent as { text?: unknown; content?: unknown };
    if (typeof structured.text === "string") parts.push(structured.text);
    if (typeof structured.content === "string") parts.push(structured.content);
  }

  const text = parts.join("\n").replace(/^\[Resource:\s*qmd:\/\/[^\]]+\]\s*\r?\n/i, "");
  if (!text) throw new QmdDocumentError(502, "QMD returned an empty document.");
  if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) {
    throw new QmdDocumentError(413, "QMD document exceeds the 2 MiB viewer limit.");
  }
  return text;
}

/** Fetch one validated QMD document through the configured HTTP MCP server. */
export async function fetchQmdDocument(reference: ParsedQmdReference, signal?: AbortSignal): Promise<string> {
  const definition = configuredQmdServer();
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const ownedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const client = new Client({ name: "piclaw-qmd-viewer", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(definition.url, {
    requestInit: definition.requestInit,
  });

  try {
    await client.connect(transport, { signal: ownedSignal, timeout: REQUEST_TIMEOUT_MS });
    const args: Record<string, unknown> = {
      file: reference.file,
      lineNumbers: false,
    };
    if (reference.fromLine !== undefined) args.fromLine = reference.fromLine;
    if (reference.maxLines !== undefined) args.maxLines = reference.maxLines;
    const result = await client.callTool(
      { name: "get", arguments: args },
      undefined,
      { signal: ownedSignal, timeout: REQUEST_TIMEOUT_MS },
    );
    return extractText(result);
  } catch (error) {
    if (error instanceof QmdDocumentError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (ownedSignal.aborted || /(?:timed?\s*out|timeout|aborted)/i.test(message)) {
      throw new QmdDocumentError(504, "QMD document retrieval timed out.");
    }
    throw new QmdDocumentError(502, "QMD document retrieval failed.");
  } finally {
    void client.close().catch((error) => {
      debugSuppressedError(log, "Failed to close QMD viewer MCP client.", error, {
        operation: "qmd_document.close_client",
      });
    });
  }
}

export function resetQmdDocumentServiceForTests(): void {
  // Kept for test compatibility. The service deliberately holds no connection state.
}
