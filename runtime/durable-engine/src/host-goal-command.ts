import { admitSqliteWrite } from "../../src/db/sqlite-async-admission.js";
import { compactGoalInput } from "./host-goal-input.js";
import type Database from "bun:sqlite";
import type { AgentControlResult } from "../../src/agent-control/index.js";
import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";

type GoalCommandState = { goal_id: string; lifecycle_generation: number; updated_at: string };
/** Native command execution; no AgentSession/ExtensionContext emulation. The host
 * checks routing and exclusive ownership before and throughout the SQLite write. */
export function createHostGoalCommand(addon: {
  applyGoalCommand(chat: string, args: string): { text: string; goal: GoalCommandState | null; continuation?: string };
  goalInputIdentity(text: string): { goalId: string; generation: number } | false | null;
  prepareGoalInput(text: string, chat: string): { decision: { action: string; text?: string } };
}, options: {
  root: Database;
  assertAdmission(chat: string): void;
  admit(input: { sourceId: string; chatJid: string; text: string; queuedAt: string }): number | null;
}) {
  return async (chatJid: string, rawText: string): Promise<AgentControlResult> => {
    options.assertAdmission(chatJid);
    const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(rawText.trim());
    if (!match) return { status: "error", message: "Native slash command unavailable" };
    const authority = { extensionId: "goal", chatJid, assertCurrent() { options.assertAdmission(chatJid); },
      write<T>(body: () => T): T {
        this.assertCurrent();
        if (!options.root.inTransaction) throw Error("Admitted Goal write transaction required");
        const value = body(); this.assertCurrent(); return value;
      } };
    return admitSqliteWrite(options.root, () => withExtensionKvAuthority(authority, () => {
      const result = addon.applyGoalCommand(chatJid, match[1] ?? "");
      if (result.continuation) {
        if (!result.goal) throw Error("Goal command continuation identity required");
        const prepared = addon.prepareGoalInput(result.continuation, chatJid).decision;
        if (prepared.action !== "transform" || !prepared.text) throw Error("Goal command input no longer executable");
        const goal = result.goal;
        if (options.admit({ sourceId: `goal-command:${goal.goal_id}:${goal.lifecycle_generation}`, chatJid,
          text: compactGoalInput(addon, result.continuation, prepared), queuedAt: goal.updated_at }) === null) throw Error("Goal command continuation admission unavailable");
      }
      authority.assertCurrent();
      return { status: "success", message: result.text + (result.continuation ? " — continuation queued" : "") };
    }), authority.assertCurrent);
  };
}
