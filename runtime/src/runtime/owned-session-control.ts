import type { AgentPool } from "../agent-pool.js";
import { getDb } from "../db/connection.js";
import { getChatCursor, getFailedRun } from "../db.js";
import { ChatAccessDenied } from "../db/session-ownership.js";
import { resolveOwnedSessionTarget } from "../agent-pool/owned-session-target.js";
import { getSessionActivitySnapshot } from "../extensions/session-status.js";
import type { SessionControlRequest, SessionControlResult } from "../extensions/session-control.js";
import { requireFamilyToolAccess } from '../agent-pool/family-tool-access.js';

/** Family inspection avoids hydration and mutating queue/control paths. */
export function inspectOwnedSession(agentPool: Pick<AgentPool, "isActive" | "isStreaming">, request: SessionControlRequest): SessionControlResult {
  requireFamilyToolAccess('session_control');
  const target = resolveOwnedSessionTarget(request.source_chat_jid, request);
  if (request.action !== "inspect" && request.action !== "assess_stuck") throw new ChatAccessDenied();
  const activity = getSessionActivitySnapshot(target.chat_jid);
  const failed = getFailedRun(target.chat_jid);
  // Metadata only; avoid provider/model inventory or paths from unscoped runtime snapshots.
  const before = {
    chat_jid: target.chat_jid, active: agentPool.isActive(target.chat_jid), streaming: agentPool.isStreaming(target.chat_jid),
    compacting: Boolean(activity?.isCompacting),
    active_tools: activity?.activeTools?.map(tool => ({ name: tool.toolName, running_for_ms: Date.now() - tool.startedAt })) ?? [],
    last_event_at: activity?.lastEventAt ? new Date(activity.lastEventAt).toISOString() : null,
    failed_run: failed ? { failed: true } : null, cursor: getChatCursor(target.chat_jid),
    pending_fork_seed: Boolean(getDb().query("SELECT 1 FROM owned_fork_operations WHERE target_branch_id=? AND seed_json IS NOT NULL").get(target.branch_id)),
  };
  return {
    ok: true, action: request.action, source_chat_jid: request.source_chat_jid, target_chat_jid: target.chat_jid,
    target_agent_name: target.agent_name, target_session_tree: { ...target }, before,
    ...(request.action === "assess_stuck" ? { assessment: failed ? "failed_run" : before.compacting ? "compacting" : before.streaming ? "streaming" : before.active_tools.length ? "tool_running" : "idle" } : {}),
  };
}
