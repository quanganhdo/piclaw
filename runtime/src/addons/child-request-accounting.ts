import type Database from 'bun:sqlite';
import type { ChildRequestHostDependencies } from './child-request-scope.js';
import type { BudgetProviderEvidence } from '../budget/types.js';
import { getDb } from '../db/connection.js';
import { modelRequestAccounting } from '../budget/model-request-accounting.js';

/** Captured host authority/database only. Caller never supplies charge amounts.
 * Admission checks the singleton remains this connection; late settlement uses
 * the captured handle and identity even after the parent work is cancelled. */
export function childRequestAccounting(input: {
  authorise(): void;
  providerEvidence?: BudgetProviderEvidence[];
  documentedFree: boolean;
}, database: Database = getDb()): Pick<ChildRequestHostDependencies, 'reserve' | 'dispatch' | 'abandon' | 'settle'> {
  const accounting = modelRequestAccounting(input, database);
  return {
    reserve: accounting.reserve,
    dispatch: accounting.dispatch,
    async abandon(binding) { await accounting.abandon(binding); },
    async settle(binding, terminal) {
      const row = await accounting.settle(binding, terminal.type === 'done' ? terminal.message : terminal.error);
      if (row.state !== 'settled') throw Error('Child request usage is unresolved.');
    },
  };
}
