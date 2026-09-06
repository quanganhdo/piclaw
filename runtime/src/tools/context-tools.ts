/**
 * tools/context-tools.ts – Enhanced tool definitions for the pi-agent runtime.
 *
 * Wraps the standard bash tool with output-storage logic: when a command
 * produces output exceeding configurable thresholds, the full output is
 * stored via tool-output.ts and only a preview is returned to the agent's
 * context window. This keeps the context lean while preserving searchability.
 *
 * Also provides:
 *   - search_tool_output: lets the agent search stored tool outputs by query.
 *   - batch_exec: runs multiple shell commands sequentially with summaries.
 *
 * Consumers:
 *   - agent-pool.ts registers these tools on the pi-agent session so the
 *     agent can invoke "bash", "search_tool_output", and "exec_batch".
 */

import { existsSync } from "fs";
import { Type } from "typebox";
import { createBashTool } from "@earendil-works/pi-coding-agent";

import { getToolOutputPresentationConfig } from "../core/config.js";
import { createToolOutputAccessGuard, ToolOutputAccessDenied } from "../core/tool-output-access.js";
import { buildPreview, saveToolOutput, searchToolOutput, getToolOutput, readToolOutputFile } from "../tool-output.js";
import { createTrackedBashOperations } from "./tracked-bash.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";

const log = createLogger("tools.context-tools");

const { storeBytes: STORE_THRESHOLD_BYTES, storeLines: STORE_THRESHOLD_LINES, previewLines: PREVIEW_LINES, previewLineChars: PREVIEW_LINE_CHARS } = getToolOutputPresentationConfig();

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type BashToolInstance = ReturnType<typeof createBashTool>;
type BashToolParams = Parameters<BashToolInstance["execute"]>[1];
type BashToolSignal = Parameters<BashToolInstance["execute"]>[2];
type BashToolUpdate = Parameters<BashToolInstance["execute"]>[3];

function guardOutputUpdates(checkAccess: () => void, onUpdate?: BashToolUpdate): BashToolUpdate {
  if (!onUpdate) return undefined;
  return (update) => {
    // SDK updates can arrive from stream event listeners: never throw a denial
    // into that emitter. The guard latches it and execute rejects on completion.
    try { checkAccess(); } catch { return; }
    try { onUpdate(update); } finally {
      // Preserve caller callback errors, but always latch access loss.
      try { checkAccess(); } catch (error) {
        debugSuppressedError(log, "Output access changed during an update callback", error, { operation: "context_tools.update_denied" });
      }
    }
  };
}

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const block = item as { type?: unknown; text?: unknown };
      if (block.type !== "text") return "";
      return typeof block.text === "string" ? block.text : "";
    })
    .join("");
}

function readDetailsStringField(details: unknown, key: string): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function shouldStoreOutput(text: string, lineCount: number): boolean {
  const bytes = Buffer.byteLength(text || "", "utf8");
  return bytes > STORE_THRESHOLD_BYTES || lineCount > STORE_THRESHOLD_LINES;
}

/** Create an enhanced bash tool that persists large outputs as tool output files. */
export function createContextBashTool(cwd: string) {
  const base = createBashTool(cwd, { operations: createTrackedBashOperations() });

  return {
    ...base,
    label: "bash",
    description: `${base.description} Large outputs are stored and summarized to save context.`,
    execute: async (toolCallId: string, params: BashToolParams, signal?: BashToolSignal, onUpdate?: BashToolUpdate) => {
      const checkAccess = createToolOutputAccessGuard();
      const guardedUpdate = guardOutputUpdates(checkAccess, onUpdate);
      let result;
      try { result = await base.execute(toolCallId, params, signal, guardedUpdate); } finally { checkAccess(); }
      const text = extractTextContent(result.content);

      let fullOutput = text;
      const fullOutputPath = readDetailsStringField(result.details, "fullOutputPath");
      if (fullOutputPath && existsSync(fullOutputPath)) {
        const fileText = readToolOutputFile(fullOutputPath);
        if (fileText !== null) fullOutput = fileText;
      }

      const lineCount = fullOutput ? fullOutput.replace(/\r\n/g, "\n").split("\n").length : 0;
      if (!shouldStoreOutput(fullOutput, lineCount)) {
        return result;
      }

      const preview = buildPreview(fullOutput, PREVIEW_LINES, PREVIEW_LINE_CHARS);
      const saved = saveToolOutput(fullOutput, {
        source: `bash:${params.command}`,
        summary: preview,
      });

      const summaryText = [
        `Output stored as tool-output:${saved.id} (${saved.lineCount} lines, ${formatBytes(saved.sizeBytes)}).`,
        preview ? `Preview:\n${preview}` : null,
        `Use search_tool_output with handle "${saved.id}" and a query to retrieve relevant snippets.`,
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        content: [{ type: "text", text: summaryText }],
        details: {
          storedOutputId: saved.id,
          storedOutputPath: saved.path,
          storedOutputLines: saved.lineCount,
          storedOutputBytes: saved.sizeBytes,
        },
      };
    },
  };
}

/** Create a tool that searches across stored tool output snippets. */
export function createToolOutputSearchTool() {
  return {
    name: "search_tool_output",
    label: "search_tool_output",
    description: "Search stored tool output by handle and query, returning compact snippets.",
    parameters: Type.Object({
      handle: Type.String({ description: "Tool output handle, e.g. out_..." }),
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ description: "Max snippets to return", default: 5 })),
    }),
    execute: async (_toolCallId: string, params: { handle: string; query: string; limit?: number }) => {
      createToolOutputAccessGuard();
      const handle = params.handle.trim();
      const query = params.query.trim();
      const limit = params.limit && params.limit > 0 ? Math.floor(params.limit) : 5;

      const record = getToolOutput(handle);
      if (!record) {
        return { content: [{ type: "text", text: `No tool output found for handle ${handle}.` }], details: {} };
      }

      const snippets = searchToolOutput(handle, query, limit);
      if (snippets.length === 0) {
        const meta = `${record.line_count ?? 0} lines, ${formatBytes(record.size_bytes ?? 0)}`;
        return {
          content: [{ type: "text", text: `No matches for "${query}" in tool-output:${handle} (${meta}).` }],
          details: {},
        };
      }

      const lines = snippets.map((snippet) => `• ${snippet}`);
      const meta = `${record.line_count ?? 0} lines, ${formatBytes(record.size_bytes ?? 0)}`;
      const text = [
        `Matches for "${query}" in tool-output:${handle} (${meta}):`,
        ...lines,
        "Use a more specific query to narrow results if needed.",
      ].join("\n");

      return { content: [{ type: "text", text }], details: {} };
    },
  };
}

/** Create a tool that executes multiple bash commands in a single call. */
export function createBatchExecTool(cwd: string, bashTool = createContextBashTool(cwd)) {
  const base = bashTool;
  return {
    name: "exec_batch",
    label: "exec_batch",
    description: "Run multiple shell commands and return concise summaries for each.",
    parameters: Type.Object({
      commands: Type.Array(Type.String({ description: "Shell commands to execute" })),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds per command" })),
    }),
    execute: async (
      toolCallId: string,
      params: { commands: string[]; timeout?: number },
      signal?: BashToolSignal,
      onUpdate?: BashToolUpdate,
    ) => {
      const checkAccess = createToolOutputAccessGuard();
      const guardedUpdate = guardOutputUpdates(checkAccess, onUpdate);
      const outputs: string[] = [];
      for (const command of params.commands || []) {
        checkAccess();
        if (signal?.aborted) {
          throw new Error("aborted");
        }
        try {
          const result = await base.execute(toolCallId, { command, timeout: params.timeout }, signal, guardedUpdate);
          checkAccess();
          const text = extractTextContent(result.content).trim() || "(no output)";
          outputs.push(`Command: ${command}\n${text}`);
        } catch (err) {
          if (err instanceof ToolOutputAccessDenied) throw err;
          checkAccess();
          if (signal?.aborted || (err instanceof Error && err.message === "aborted")) {
            throw err;
          }
          const message = err instanceof Error ? err.message : String(err);
          outputs.push(`Command: ${command}\nError: ${message}`);
        }
      }
      const joined = outputs.join("\n\n");
      return { content: [{ type: "text", text: joined }], details: {} };
    },
  };
}
