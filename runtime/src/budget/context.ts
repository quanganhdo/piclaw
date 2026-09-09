import { AsyncLocalStorage } from "node:async_hooks";

import type { BudgetWorkContext } from "./types.js";

const budgetWorkStorage = new AsyncLocalStorage<BudgetWorkContext | null>();

export function getBudgetWorkContext(): BudgetWorkContext | null {
  return budgetWorkStorage.getStore() ?? null;
}

export function withBudgetWorkContext<T>(context: BudgetWorkContext, run: () => T): T {
  return budgetWorkStorage.run(Object.freeze({ ...context }), run);
}
