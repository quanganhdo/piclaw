/**
 * extensions/session-status.ts — Cross-session visibility tool.
 *
 * Lets any session see which other sessions are active, what model they're
 * using, whether they're streaming, and which tools are running.
 *
 * Controlled by the `session_isolation` setting:
 *   - "none" (default): full visibility — sessions, models, tool names + args
 *   - "summary": sessions, models, tool names — NO args, prompts, or responses
 *   - "full": no cross-session visibility at all
 *
 * The exit_process tool checks this before restarting to warn if other
 * sessions are active.
 */

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readAccessConfig } from "../core/config-access.js";
import { getChatJid } from "../core/chat-context.js";
import { listCurrentOwnerSessions } from "../agent-pool/owned-session-target.js";
import { requireFamilyToolAccess } from '../agent-pool/family-tool-access.js';
import {
  getSessionIsolationLevel,
  setSessionIsolationLevel,
  type SessionIsolationLevel,
} from "../core/config.js";

export { getSessionIsolationLevel, setSessionIsolationLevel };
export type { SessionIsolationLevel };

// ── Global activity tracker ──────────────────────────────────────

export interface ActiveToolInfo {
  toolName: string;
  toolCallId: string;
  startedAt: number;
  args?: unknown;
}

export interface SessionActivity {
  chatJid: string;
  isStreaming: boolean;
  isCompacting: boolean;
  model: string | null;
  thinkingLevel: string | null;
  activeTools: ActiveToolInfo[];
  lastEventAt: number;
}

const activityMap = new Map<string, SessionActivity>();

function getActivity(chatJid: string): SessionActivity {
  if (!activityMap.has(chatJid)) {
    activityMap.set(chatJid, {
      chatJid,
      isStreaming: false,
      isCompacting: false,
      model: null,
      thinkingLevel: null,
      activeTools: [],
      lastEventAt: 0,
    });
  }
  return activityMap.get(chatJid)!;
}

export function updateSessionStreaming(chatJid: string, isStreaming: boolean): void {
  const a = getActivity(chatJid);
  a.isStreaming = isStreaming;
  a.lastEventAt = Date.now();
  if (!isStreaming) {
    a.activeTools = [];
  }
}

export function updateSessionCompacting(chatJid: string, isCompacting: boolean): void {
  const a = getActivity(chatJid);
  a.isCompacting = isCompacting;
  a.lastEventAt = Date.now();
}

export function updateSessionModel(chatJid: string, model: string | null, thinkingLevel?: string | null): void {
  const a = getActivity(chatJid);
  if (model !== undefined) a.model = model;
  if (thinkingLevel !== undefined) a.thinkingLevel = thinkingLevel ?? null;
  a.lastEventAt = Date.now();
}

export function trackToolStart(chatJid: string, toolCallId: string, toolName: string, args?: unknown): void {
  const a = getActivity(chatJid);
  a.activeTools.push({ toolName, toolCallId, startedAt: Date.now(), args });
  a.lastEventAt = Date.now();
}

export function trackToolEnd(chatJid: string, toolCallId: string): void {
  const a = getActivity(chatJid);
  a.activeTools = a.activeTools.filter((t) => t.toolCallId !== toolCallId);
  a.lastEventAt = Date.now();
}

export function removeSession(chatJid: string): void {
  activityMap.delete(chatJid);
}

export function clearSessionStatusForTests(): void {
  activityMap.clear();
}

export function getActiveSessionCount(excludeChatJid?: string): number {
  let count = 0;
  for (const [jid, activity] of activityMap) {
    if (excludeChatJid && jid === excludeChatJid) continue;
    if (activity.isStreaming || activity.isCompacting) count++;
  }
  return count;
}

function cloneActivity(activity: SessionActivity): SessionActivity {
  return {
    ...activity,
    activeTools: activity.activeTools.map((tool) => ({ ...tool })),
  };
}

export function getSessionActivitySnapshot(chatJid: string): SessionActivity | null {
  const activity = activityMap.get(chatJid);
  return activity ? cloneActivity(activity) : null;
}

export function getActiveSessions(excludeChatJid?: string): SessionActivity[] {
  const result: SessionActivity[] = [];
  for (const [jid, activity] of activityMap) {
    if (excludeChatJid && jid === excludeChatJid) continue;
    if (activity.isStreaming || activity.isCompacting || activity.activeTools.length > 0) {
      result.push(cloneActivity(activity));
    }
  }
  return result;
}

// ── Extension ────────────────────────────────────────────────────

export const sessionStatus: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "session_status",
    label: "session_status",
    description: "Check which other agent sessions are currently active, what model they use, and what tools they are running.",
    promptSnippet: "session_status: see if other sessions are actively running, their models, and current tools. Use before exit_process to check for active work.",
    parameters: Type.Object({
      action: Type.Optional(Type.Union([
        Type.Literal("list"),
        Type.Literal("check"),
      ])),
    }),
    async execute(_toolCallId, params, _signal, _update, ctx) {
      try { requireFamilyToolAccess('session_status'); }
      catch { return { content: [{ type: 'text', text: 'Session access denied.' }], details: { error: 'access_denied', available: false, safe_to_restart: false } }; }
      const level = getSessionIsolationLevel();

      if (level === "full") {
        return {
          content: [{ type: "text", text: "Session isolation is enabled. Cross-session visibility is disabled." }],
          details: { isolation: "full", available: false },
        };
      }

      const family = readAccessConfig().mode !== "single-user";
      let allowed: Set<string> | null = null;
      if (family) {
        try { allowed = new Set(listCurrentOwnerSessions().map(branch => branch.chat_jid)); }
        catch { return { content: [{ type: "text", text: "Session access denied." }], details: { error: "access_denied", available: false, safe_to_restart: false } }; }
      }
      const callerJid = family ? getChatJid("") : (ctx as any)?.chatJid || "";
      const active = getActiveSessions(callerJid).filter(session => !allowed || allowed.has(session.chatJid));
      const action = params.action || "list";
      if (family && action === "check") return {
        content: [{ type: "text", text: `${active.length} other owned session(s) active. Other owners are not inspected; this is not permission to restart the shared service.` }],
        details: { isolation: "owner", active_sessions: active.length, safe_to_restart: false, instance_restart_authorised: false },
      };

      if (action === "check") {
        const count = active.length;
        const text = count === 0
          ? "No other sessions are currently active. Safe to restart."
          : `${count} other session(s) currently active. Restarting now may interrupt their work.`;
        return {
          content: [{ type: "text", text }],
          details: {
            isolation: level,
            active_sessions: count,
            safe_to_restart: count === 0,
          },
        };
      }

      // list
      if (active.length === 0) {
        return {
          content: [{ type: "text", text: family ? "No other owned sessions are currently active; other owners are not inspected." : "No other sessions are currently active." }],
          details: { isolation: family ? "owner" : level, sessions: [] },
        };
      }

      const sessions = active.map((s) => {
        const base: Record<string, unknown> = {
          chat: s.chatJid,
          streaming: s.isStreaming,
          compacting: s.isCompacting,
          model: s.model,
        };

        if (level === "none" && !family) {
          // Full visibility: tool names + args
          base.tools = s.activeTools.map((t) => ({
            name: t.toolName,
            args: t.args,
            running_for_ms: Date.now() - t.startedAt,
          }));
        } else {
          // Summary: tool names only, no args
          base.tools = s.activeTools.map((t) => ({
            name: t.toolName,
            running_for_ms: Date.now() - t.startedAt,
          }));
        }

        return base;
      });

      const lines = sessions.map((s) => {
        const tools = (s.tools as Array<{ name: string; running_for_ms: number }>);
        const toolStr = tools.length > 0
          ? ` — running: ${tools.map((t) => `${t.name} (${Math.round(t.running_for_ms / 1000)}s)`).join(", ")}`
          : "";
        return `- ${s.chat}: ${s.model || "unknown model"}${s.streaming ? " [streaming]" : ""}${s.compacting ? " [compacting]" : ""}${toolStr}`;
      });

      return {
        content: [{ type: "text", text: `${active.length} active session(s):\n${lines.join("\n")}` }],
        details: { isolation: family ? "owner" : level, sessions },
      };
    },
  });
};
