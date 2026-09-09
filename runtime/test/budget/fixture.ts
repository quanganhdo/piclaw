import { beforeEach, afterEach } from 'bun:test';
import { createTempWorkspace, setEnv, type TempWorkspace } from '../helpers.js';
import { initDatabase, closeDatabase } from '../../src/db.js';

/** Instance-wide spend must never include another test's persisted usage. */
export function isolateBudgetTestDatabase(): void {
  let workspace: TempWorkspace;
  let restore: () => void;
  beforeEach(() => {
    workspace = createTempWorkspace('budget-test-');
    restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
    initDatabase();
  });
  afterEach(() => {
    closeDatabase();
    restore();
    workspace.cleanup();
  });
}
