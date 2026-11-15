import { getExtensionKvStore, withExtensionKvAuthority, type ExtensionKvAuthority } from "../../src/extension-kv-registry.js";

type Goal = { goal_id: string; lifecycle_generation: number; status: string };
type Cursor = { entryId: number; tokens: number; goalId: string; acceptedGeneration?: number;
  budget?: { operationId: string; generation: number } };
type BudgetSource = { operationId: string; conversationId: number };
type BudgetAddon = {
  loadThreadGoal(chat: string): Goal | null;
  goalInputIdentity(text: string): { goalId: string; generation: number } | false | null;
  isGoalBudgetInput(text: string): boolean;
  resolveGoalInput(text: string, chat: string): { action: string; text?: string };
};
/** A fresh, explicitly admitted budget prompt or this operation's own committed
 * budget transition. A current status or an older operation's cursor is insufficient.
 * Caller supplies the existing Goal KV scope and actual SDK/host source identity. */
export function isGoalBudgetWrapup(addon: BudgetAddon, chat: string, texts: readonly string[], source: BudgetSource): boolean {
  if (!Number.isSafeInteger(source.conversationId) || source.conversationId <= 0 || !source.operationId) return false;
  const goal = addon.loadThreadGoal(chat), identities = texts.map(text => addon.goalInputIdentity(text));
  if (!goal || goal.status !== "budget_limited" || !identities.length || identities.some(identity => !identity)) return false;
  const identity = identities[0]!;
  if (!identity || identity.goalId !== goal.goal_id || identities.some(other => !other || other.goalId !== identity.goalId || other.generation !== identity.generation)) return false;
  if (identity.generation === goal.lifecycle_generation && texts.every(text => {
    const decision = addon.resolveGoalInput(text, chat);
    return decision.action !== "handled" && addon.isGoalBudgetInput(decision.text ?? text);
  })) return true;
  const cursor = getExtensionKvStore().get<Cursor>("goal", `committed-usage:${source.conversationId}`, "chat", chat);
  return goal.lifecycle_generation === identity.generation + 1 && cursor?.goalId === goal.goal_id &&
    cursor.acceptedGeneration === identity.generation && cursor.budget?.operationId === source.operationId &&
    cursor.budget.generation === goal.lifecycle_generation;
}
/** Trusted host evidence from hasGoalTerminalResult for this captured operation. */
type TerminalProof = { goalId: string; generation: number; status: "complete" | "stopped" };
/** Apply an already-verified committed assistant entry. The SDK reader must feed
 * entries in ascending order after the Goal's start boundary. Not provider events.
 * Cursor and Goal mutation share the caller's operation-owned SQLite transaction. */
export function accountCommittedGoalEntry(addon: {
  loadThreadGoal(chat: string): Goal | null;
  accountGoalProgress(chat: string, tokens: number): unknown;
  accountTerminalGoalProgress?(chat: string, expected: { goalId: string; generation: number }, tokens: number): unknown;
}, authority: ExtensionKvAuthority, entry: {
  goalId: string; generation: number; conversationId: number; entryId: number; tokens: number;
}, terminalProof?: TerminalProof): boolean {
  if (authority.extensionId !== "goal" || !entry.goalId ||
    ![entry.generation, entry.conversationId, entry.entryId].every(value => Number.isSafeInteger(value) && value > 0) ||
    !Number.isSafeInteger(entry.tokens) || entry.tokens < 0) throw Error("Invalid committed Goal usage");
  return authority.write(() => withExtensionKvAuthority(authority, () => {
    authority.assertCurrent();
    const goal = addon.loadThreadGoal(authority.chatJid);
    const terminal = terminalProof && goal && goal.goal_id === terminalProof.goalId &&
      goal.lifecycle_generation === terminalProof.generation && goal.status === terminalProof.status &&
      (terminalProof.status === "complete" || terminalProof.status === "stopped");
    if (!goal || goal.goal_id !== entry.goalId || goal.lifecycle_generation !== entry.generation ||
      (terminalProof ? !terminal : goal.status !== "active" && goal.status !== "budget_limited")) throw Error("Goal usage lifecycle changed");
    const store = getExtensionKvStore();
    const key = `committed-usage:${entry.conversationId}`;
    const saved = store.get<Cursor>("goal", key, "chat", authority.chatJid);
    const prior = saved?.goalId === entry.goalId ? saved : undefined;
    if (prior) {
      if (entry.entryId < prior.entryId) throw Error("Goal usage entries out of order");
      if (entry.entryId === prior.entryId) {
        if (entry.tokens !== prior.tokens) throw Error("Committed Goal usage changed");
        return false;
      }
    }
    if (terminalProof) {
      if (!addon.accountTerminalGoalProgress) throw Error("Terminal Goal accounting export required");
      addon.accountTerminalGoalProgress(authority.chatJid, terminalProof, entry.tokens);
    } else addon.accountGoalProgress(authority.chatJid, entry.tokens);
    store.set("goal", key, { goalId: entry.goalId, entryId: entry.entryId, tokens: entry.tokens }, "chat", authority.chatJid);
    authority.assertCurrent();
    return true;
  }));
}

/** Bind a read-only SDK receipt batch to a validated accepted Goal input. The
 * caller obtains both texts and receipts from the same captured host operation.
 * No awaits between lifecycle validation, cursor reads and atomic application. */
export function accountCommittedGoalBatch(addon: BudgetAddon & {
  accountGoalProgress(chat: string, tokens: number): unknown;
  accountTerminalGoalProgress?(chat: string, expected: { goalId: string; generation: number }, tokens: number): unknown;
}, authority: ExtensionKvAuthority, texts: readonly string[], receipts: readonly {
  conversationId: number; entryId: number; tokens: number;
}[], terminalProof?: TerminalProof, source?: BudgetSource): number {
  return authority.write(() => withExtensionKvAuthority(authority, () => {
    authority.assertCurrent();
    const identities = texts.map(text => addon.goalInputIdentity(text));
    if (!identities.length || identities.some(identity => !identity)) throw Error("Explicit accepted Goal identity required");
    const identity = identities[0]!;
    if (!identity || identities.some(other => !other || other.goalId !== identity.goalId || other.generation !== identity.generation))
      throw Error("Conflicting accepted Goal identities");
    const goal = addon.loadThreadGoal(authority.chatJid);
    if (!goal || goal.goal_id !== identity.goalId) throw Error("Goal usage lifecycle changed");
    const terminal = terminalProof && terminalProof.goalId === identity.goalId && terminalProof.generation === identity.generation + 1 &&
      goal.lifecycle_generation === terminalProof.generation && goal.status === terminalProof.status &&
      (terminalProof.status === "complete" || terminalProof.status === "stopped");
    if (terminalProof && !terminal) throw Error("Goal usage lifecycle changed");
    const budgetWrapup = source && isGoalBudgetWrapup(addon, authority.chatJid, texts, source);
    const replayOnly = !budgetWrapup && goal.status === "budget_limited" && goal.lifecycle_generation === identity.generation + 1;
    if (!terminal && !replayOnly && !budgetWrapup && (goal.lifecycle_generation !== identity.generation || goal.status !== "active"))
      throw Error("Goal usage lifecycle changed");
    let previous = 0, conversation: number | undefined, applied = 0;
    for (const receipt of receipts) {
      if (![receipt.entryId, receipt.conversationId].every(value => Number.isSafeInteger(value) && value > 0) ||
        !Number.isSafeInteger(receipt.tokens) || receipt.tokens < 0) throw Error("Invalid committed Goal usage");
      if (receipt.entryId <= previous || (conversation !== undefined && receipt.conversationId !== conversation))
        throw Error("Goal usage batch out of order");
      previous = receipt.entryId; conversation = receipt.conversationId;
      if (source && receipt.conversationId !== source.conversationId) throw Error("Goal usage source conversation changed");
      const cursor = getExtensionKvStore().get<Cursor>("goal", `committed-usage:${receipt.conversationId}`, "chat", authority.chatJid);
      if (replayOnly) {
        if (!cursor || cursor.goalId !== goal.goal_id || cursor.acceptedGeneration !== identity.generation || receipt.entryId > cursor.entryId ||
          (receipt.entryId === cursor.entryId && receipt.tokens !== cursor.tokens)) throw Error("Goal usage lifecycle changed");
        continue;
      }
      if (cursor?.goalId === goal.goal_id && receipt.entryId < cursor.entryId) continue;
      const current = addon.loadThreadGoal(authority.chatJid)!;
      if (accountCommittedGoalEntry(addon, authority, { ...receipt, goalId: goal.goal_id, generation: current.lifecycle_generation }, terminalProof)) {
        applied++;
        const next = addon.loadThreadGoal(authority.chatJid)!;
        const budget = source && current.status === "active" && next.status === "budget_limited" && next.lifecycle_generation === identity.generation + 1
          ? { operationId: source.operationId, generation: next.lifecycle_generation } : cursor?.goalId === goal.goal_id ? cursor.budget : undefined;
        getExtensionKvStore().set("goal", `committed-usage:${receipt.conversationId}`,
          { goalId: goal.goal_id, entryId: receipt.entryId, tokens: receipt.tokens, acceptedGeneration: identity.generation, ...(budget ? { budget } : {}) }, "chat", authority.chatJid);
      }
    }
    authority.assertCurrent();
    return applied;
  }));
}
