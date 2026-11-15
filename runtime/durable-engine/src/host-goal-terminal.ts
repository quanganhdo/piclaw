import type Database from "bun:sqlite";
import { defineExtension, type ToolHooks } from "@earendil-works/pi-durable";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";

type TerminalGoal = { goal_id: string; lifecycle_generation: number; status: string };
/** Stop further tool execution after this accepted operation's own terminal Goal tool.
 * A completed Goal from an older operation never blocks a new user turn. */
export function createHostGoalTerminalFence(addon: {
  loadThreadGoal(chat: string): TerminalGoal | null;
  goalInputIdentity(text: string): unknown;
}, options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, "capturePendingToolSource" | "hasGoalTerminalResult" | "readCapturedInputText">;
  assertOwner(): void;
}) {
  const load = addon.loadThreadGoal.bind(addon);
  const beforeTool: NonNullable<ToolHooks["beforeTool"]> = async (call, api) => {
    options.assertOwner();
    const runtime = options.runtime();
    const captured = await runtime.capturePendingToolSource(api.conversationId, api.taskId, call.id);
    const authority = createHostOperationAuthority(options.root, captured, options.assertOwner, true);
    const readGoal = () => withExtensionKvAuthority({ extensionId: "goal", chatJid: captured.operation.chatJid,
      assertCurrent: authority.assertCurrent, write: authority.write }, () => {
      authority.assertCurrent();
      return load(captured.operation.chatJid);
    });
    const goal = readGoal();
    if (!goal || !["complete", "stopped", "budget_limited"].includes(goal.status)) return;
    const budget = goal.status === "budget_limited";
    const terminal = budget ? (await runtime.readCapturedInputText(captured.inputs)).some(text => addon.goalInputIdentity(text) !== null)
      : await runtime.hasGoalTerminalResult(api.conversationId, captured.runTaskId, {
      goalId: goal.goal_id, generation: goal.lifecycle_generation, status: goal.status,
    } as { goalId: string; generation: number; status: "complete" | "stopped" });
    authority.assertCurrent();
    const current = readGoal();
    if (!current || current.goal_id !== goal.goal_id || current.lifecycle_generation !== goal.lifecycle_generation || current.status !== goal.status)
      throw Error("Goal tool lifecycle changed");
    if (terminal) return { block: budget ? "Goal token budget reached; provide the final wrap-up without further tools."
      : "Goal terminal state recorded; provide the final response without further tools." };
  };
  return defineExtension({ name: "app.host-goal-terminal", hooks: [{ task: "pi.tool", handlers: { beforeTool } }] });
}
