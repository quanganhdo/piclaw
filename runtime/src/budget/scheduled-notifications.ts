import type Database from "bun:sqlite";
import { getDb } from "../db/connection.js";
import { markBudgetDecisionNotified } from "../db/budget-limits.js";
import { readAccessConfig } from "../core/config-access.js";
import { getExecutionIdentity } from "../core/execution-context.js";
import { getWorkspaceDir } from "../core/config-context.js";
import { detectChannel, formatOutbound } from "../router.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("budget.scheduled-notifications");
const MAX_NOTIFICATIONS_PER_DRAIN = 20;
const MAX_DRAIN_WAIT_MS = 5_000;
export interface ScheduledBudgetNotificationDeps {
  sendMessage: (jid: string, text: string, options?: { forceRoot?: boolean; source?: string }) => Promise<void>;
}
interface PendingNotice {
  decision_id: string;
  notification_key: string;
  created_at: string;
  work_id: string;
  chat_jid: string;
  scheduled_task_id: string;
}
let activeDrain: Promise<void> | null = null;
let activeWait: Promise<void> | null = null;
// Move past failed heads on the next poll, without growing an in-memory retry list.
let cursorDatabase: Database | null = null;
let cursor: { at: string; id: string } | null = null;
function pending(database: Database): PendingNotice[] {
  if (cursorDatabase !== database) { cursorDatabase = database; cursor = null; }
  const query = (after: typeof cursor) => database.prepare(`SELECT d.id AS decision_id,d.notification_key,d.created_at,
    w.id AS work_id,w.chat_jid,w.scheduled_task_id FROM budget_decisions d JOIN budget_work w ON w.id=d.work_id
    WHERE d.decision='stop' AND d.notification_status='pending' AND d.notification_key IS NOT NULL
      AND w.execution_kind='scheduled' AND w.scheduled_task_id IS NOT NULL
      ${after ? "AND (d.created_at>? OR (d.created_at=? AND d.id>?))" : ""}
    ORDER BY d.created_at,d.id LIMIT ?`).all(...(after ? [after.at, after.at, after.id] : []), MAX_NOTIFICATIONS_PER_DRAIN) as PendingNotice[];
  const rows = query(cursor);
  return rows.length || !cursor ? rows : query(null);
}
async function drainOnce(deps: ScheduledBudgetNotificationDeps): Promise<void> {
  const deadline = Date.now() + MAX_DRAIN_WAIT_MS;
  const database = getDb(), workspace = getWorkspaceDir(), identity = getExecutionIdentity();
  let denied = false;
  const allowed = () => {
    try {
      if (denied || readAccessConfig().mode !== "single-user" || getDb() !== database
        || getWorkspaceDir() !== workspace || getExecutionIdentity() !== identity
        || (identity && identity.mode !== "single-user")) denied = true;
    } catch { denied = true; }
    return !denied;
  };
  if (!allowed()) return;
  let rows: PendingNotice[];
  try { rows = pending(database); }
  catch {
    log.error("Scheduled budget notification scan failed", { operation: "scheduled_budget_notification.scan" });
    return;
  }
  for (const notice of rows) {
    if (!allowed() || Date.now() >= deadline) return;
    cursor = { at: notice.created_at, id: notice.decision_id };
    // Recheck the current pending row before dispatch in case an earlier send
    // or another local consumer acknowledged it while this batch was pending.
    if (!database.query("SELECT 1 FROM budget_decisions WHERE id=? AND notification_status='pending'").get(notice.decision_id)) continue;
    const text = formatOutbound(`Scheduled task ${notice.scheduled_task_id} stopped by budget policy before another paid model call.\nReview its budget limits and run history before running it again.`, detectChannel(notice.chat_jid));
    if (!text) continue;
    try {
      await deps.sendMessage(notice.chat_jid, text, { forceRoot: true, source: "scheduled" });
      if (!allowed()) return;
      // A successful send followed by a lost acknowledgement/DB failure can
      // duplicate the notice. This is at-least-once, never an agent-task replay.
      markBudgetDecisionNotified(notice.decision_id, database);
    } catch {
      if (!allowed()) return;
      log.warn("Scheduled budget notification delivery failed", {
        operation: "scheduled_budget_notification.deliver", decisionId: notice.decision_id,
        notificationKey: notice.notification_key, taskId: notice.scheduled_task_id,
      });
    }
  }
}
/** Bounded timeline-only retry. Muting successful-output nudges never mutes a failure notice. */
export function drainScheduledBudgetNotifications(deps: ScheduledBudgetNotificationDeps): Promise<void> {
  if (activeDrain) return activeWait!;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, MAX_DRAIN_WAIT_MS); timer.unref?.(); });
  // Bound the scheduler's wait, not the underlying transport. Keep its lock until
  // the send settles; racing a timeout must not launch overlapping retries.
  activeDrain = drainOnce(deps).finally(() => {
    clearTimeout(timer);
    activeDrain = null;
    activeWait = null;
  });
  activeWait = Promise.race([activeDrain.catch(() => {
    log.warn("Scheduled budget notification drain failed", { operation: "scheduled_budget_notification.drain" });
  }), timeout]);
  return activeWait;
}
