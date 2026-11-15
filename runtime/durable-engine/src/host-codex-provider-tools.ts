import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import { createHostTool } from "./host-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";

export interface CodexProviderInvocation {
  chatId: string; cwd: string; model: { provider?: string; api?: string; id?: string; input?: readonly string[] };
  signal?: AbortSignal; assertCurrent(): void;
}
export interface CodexProviderPorts extends CodexProviderInvocation {
  readImage(input: CodexProviderInvocation & { path: string; original: boolean; toolCallId: string }): Promise<any>;
}
export interface CodexProviderNativeExports {
  createNativeWebSearchTool(ports: CodexProviderPorts): ToolDefinition<any, any>;
  createNativeImageGenerationTool(ports: CodexProviderPorts): ToolDefinition<any, any>;
  createNativeViewImageTool(ports: CodexProviderPorts): ToolDefinition<any, any>;
}
export interface HostCodexProviderOptions {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "captureToolSource">;
  assertOwner(): void;
  /** Preserve the qualified installed declaration, never its executable callback. */
  declarations?: ReadonlyMap<string, ToolDefinition<any, any>>;
  /** Current actual parent provider/model and guarded runtime effect callbacks.
   * readImage MUST check authority after awaits and at each file/artifact effect.
   * Provider-native declarations never dispatch a standalone model request. */
  bind(invocation: { sourceModel: { provider: string; id: string; api: string }; chatId: string; signal?: AbortSignal; assertCurrent(): void }): Promise<CodexProviderPorts>;
  /** Genuine current metadata for schema construction; never synthetic model data. */
  metadata(): Pick<CodexProviderPorts, "cwd" | "model">;
}
export function createHostCodexProviderTools(addon: CodexProviderNativeExports, options: HostCodexProviderOptions) {
  return (["createNativeWebSearchTool", "createNativeImageGenerationTool", "createNativeViewImageTool"] as const).map(factory => {
    const deny = () => { throw Error("Invocation-local Codex provider authority required"); };
    const nativeDeclaration = addon[factory]({ ...options.metadata(), chatId: "", assertCurrent: deny, readImage: async () => deny() });
    const definition = options.declarations?.get(nativeDeclaration.name) ?? nativeDeclaration;
    return createHostTool(definition, {
      authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
      async invoke(args, call) {
        call.assertAllowed(); options.assertOwner();
        const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
        const authority = createHostOperationAuthority(options.root, captured, () => { call.signal?.throwIfAborted(); call.assertAllowed(); options.assertOwner(); });
        authority.assertCurrent();
        if (!captured.sourceModel) throw Error("Captured source model required");
        const ports = await options.bind({ sourceModel: captured.sourceModel, chatId: captured.operation.chatJid, signal: call.signal, assertCurrent: authority.assertCurrent });
        authority.assertCurrent();
        // Parent cannot replace captured identity or authority.
        const native = addon[factory]({ ...ports, chatId: captured.operation.chatJid, signal: call.signal, assertCurrent: authority.assertCurrent });
        const result = await native.execute(call.toolCallId, args, call.signal, undefined, undefined as never);
        authority.assertCurrent(); return result;
      },
    });
  });
}
