import type { Result } from "../contracts/result.js";
import type { CleanupScheduledRunsResult, ScheduledRunStoreError } from "../contracts/scheduled-run-store.js";

/** SQLite owner extension; legacy cleanupTerminal requests and receipt hashes
 * remain unchanged. No retention timer or caller is registered by this API. */
export interface ScheduledRetentionCursor { settledAt:string; runId:string }
export interface ScheduledRetentionPlan {
  version:1; owner:"scheduled-run-history"; settledBefore:string;
  after:ScheduledRetentionCursor|null; through:ScheduledRetentionCursor|null;
  examined:number; rows:readonly {runId:string;settledAt:string;sha256:string;serializedBytes:number}[];
  nextCursor:ScheduledRetentionCursor|null;
}
export interface ScheduledRunRetentionOwner {
  planRetention(input:{settledBefore:string;limit:number;after?:ScheduledRetentionCursor|null}):Promise<Result<ScheduledRetentionPlan,ScheduledRunStoreError>>;
  applyRetention(plan:ScheduledRetentionPlan):Promise<Result<CleanupScheduledRunsResult,ScheduledRunStoreError>>;
}
