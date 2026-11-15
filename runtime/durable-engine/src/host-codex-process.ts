import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import { createHostTool } from "./host-tools.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";

export function createHostCodexProcessTools(addon: any, options: {
  root: Database; runtime(): Pick<HostConversationRuntime, "captureToolSource">;
  assertOwner(): void; ownerIncarnation: string;
  /** Source-qualified captured declarations; execution remains native. */
  declarations?: ReadonlyMap<string, ToolDefinition<any, any>>;
  /** Must return actual current session revision and cwd, never call-local defaults. */
  bind(chatId: string): Promise<{ cwd: string; sessionRevision: string }>;
}) {
  const pool = addon.createNativeProcessPool();
  const tools = (["createNativeExecCommandTool", "createNativeWriteStdinTool"] as const).map(factory => {
    const deny = () => { throw Error("Invocation required"); };
    const definition = options.declarations?.get(factory === "createNativeExecCommandTool" ? "exec_command" : "write_stdin") ??
      addon[factory](pool, { chatId: "", ownerIncarnation: "", sessionRevision: "", cwd: "", assertCurrent: deny });
    return createHostTool(definition, {
      authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
      async invoke(args, call) {
        call.assertAllowed(); options.assertOwner();
        const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
        const authority = createHostOperationAuthority(options.root, captured, () => { call.signal?.throwIfAborted(); call.assertAllowed(); options.assertOwner(); });
        authority.assertCurrent();
        const binding = await options.bind(captured.operation.chatJid);
        authority.assertCurrent();
        const tool = addon[factory](pool, { ...binding, chatId: captured.operation.chatJid, ownerIncarnation: options.ownerIncarnation, signal: call.signal, assertCurrent: authority.assertCurrent });
        return tool.execute(call.toolCallId, args);
      },
    });
  });
  return { tools, disposeSession: pool.disposeSession, disposeIdentity: pool.disposeIdentity, dispose: pool.dispose };
}
