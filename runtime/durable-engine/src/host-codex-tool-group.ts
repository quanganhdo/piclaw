import * as fs from "node:fs";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import { createHostCodexProcessTools } from "./host-codex-process.js";
import { createHostCodexProviderTools } from "./host-codex-provider-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import { createHostTool } from "./host-tools.js";

type ProcessOptions = Parameters<typeof createHostCodexProcessTools>[1];
type ProviderOptions = Parameters<typeof createHostCodexProviderTools>[1];
type PatchFiles = Pick<typeof fs, "existsSync" | "readFileSync" | "mkdirSync" | "writeFileSync" | "unlinkSync">;
interface PatchResult {
  changedFiles: string[]; createdFiles: string[]; deletedFiles: string[]; movedFiles: string[]; fuzz: number;
}
type ProviderAddon = Parameters<typeof createHostCodexProviderTools>[0];
export interface HostCodexToolGroupAddon extends ProviderAddon {
  createNativeProcessPool(): { dispose(): void; disposeSession: any; disposeIdentity: any };
  createNativeExecCommandTool(...args: any[]): ToolDefinition<any, any>;
  createNativeWriteStdinTool(...args: any[]): ToolDefinition<any, any>;
  createNativeApplyPatchFactory(files: PatchFiles): (authority: { assertCurrent(): void }, cwd: string) => {
    execute(args: { input: string }): PatchResult;
    executeTool(args: { input: string }): { content: { type: "text"; text: string }[]; details: unknown }; dispose(): void;
  };
}
export interface HostCodexToolGroupOptions {
  process: ProcessOptions;
  provider: ProviderOptions;
  /** Original captured legacy declaration; its execute callback is never used. */
  applyPatch: ToolDefinition<any, any>;
}

/** Compose only native ports. No legacy context or standalone provider dispatch. */
export function createHostCodexToolGroup(addon: HostCodexToolGroupAddon, options: HostCodexToolGroupOptions) {
  const process = createHostCodexProcessTools(addon, options.process);
  try {
  const patch = createHostTool(options.applyPatch, {
    authority: { check: options.process.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed(); options.process.assertOwner();
      const captured = await options.process.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const authority = createHostOperationAuthority(options.process.root, captured, () => {
        call.signal?.throwIfAborted(); call.assertAllowed(); options.process.assertOwner();
      });
      authority.assertCurrent();
      const { cwd } = await options.process.bind(captured.operation.chatJid);
      authority.assertCurrent();
      // Every synchronous filesystem call is admitted inside the owned DB transaction.
      const fenced = <K extends keyof PatchFiles>(key: K): PatchFiles[K] =>
        ((...values: unknown[]) => authority.write(() =>
          (fs[key] as (...args: unknown[]) => unknown)(...values))) as PatchFiles[K];
      const native = addon.createNativeApplyPatchFactory({
        existsSync: fenced("existsSync"), readFileSync: fenced("readFileSync"),
        mkdirSync: fenced("mkdirSync"), writeFileSync: fenced("writeFileSync"), unlinkSync: fenced("unlinkSync"),
      })(authority, cwd);
      try {
        const result = native.executeTool({ input: (args as { input: string }).input });
        authority.assertCurrent();
        return result;
      } finally { native.dispose(); }
    },
  });
  return { tools: [...process.tools, patch, ...createHostCodexProviderTools(addon, options.provider)], dispose: process.dispose };
  } catch (error) { process.dispose(); throw error; }
}
