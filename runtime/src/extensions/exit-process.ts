/**
 * exit-process – agent-callable tool that gracefully terminates the piclaw process.
 *
 * When the agent needs to restart (e.g. after deploying a new build), it calls
 * this tool as the **last tool call in its turn**. The tool invokes the same
 * graceful shutdown path used by SIGINT/SIGTERM: drain the task queue, dispose
 * all agent sessions (persisting session files), stop the web server and
 * terminal/VNC bridges, then process.exit(0). Supervisor then restarts piclaw
 * with the new code.
 *
 * This replaces the old pattern of scheduling an external `supervisorctl
 * restart` from the deploy script, which could kill the process mid-turn and
 * lose the agent's response.
 */

import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { getChatJid } from "../core/chat-context.js";
import {
  buildRestartHandoffMarker,
  deleteRestartHandoff,
  markRestartHandoffReady,
  prepareRestartHandoff,
  type RestartHandoff,
} from "../runtime/restart-handoff.js";
import { markPendingShutdown } from "../runtime/shutdown-registry.js";
import { createLogger } from "../utils/logger.js";
import { killTrackedProcesses } from "../utils/process-tracker.js";
import { postMessagesToolMessage } from "./messages-crud.js";
import { getActiveSessionCount } from "./session-status.js";

const log = createLogger("extensions.exit-process");

const IS_SUPERVISED = Boolean(process.env.SUPERVISOR_ENABLED);
const RESTART_HINT = IS_SUPERVISED
  ? "Supervisor will restart it automatically."
  : "The process will exit; restart it manually or via your service manager.";

const ExitProcessSchema = Type.Object({
  reason: Type.String({
    minLength: 1,
    pattern: "\\S",
    description: "Required human-readable reason for the exit. It will be shown in the chat before shutdown.",
  }),
  resume_message: Type.Optional(Type.String({
    minLength: 1,
    pattern: "\\S",
    description: "Optional message to show as an agent self-resume and process as a new inbound turn after restart.",
  })),
});

type ExitProcessParams = {
  reason: string;
  resume_message?: string;
};

const HINT = [
  "## Process exit",
  "Use exit_process to gracefully terminate the running piclaw process after your current turn completes.",
  "A non-empty reason is required and will be posted to the active chat before shutdown is scheduled.",
  "Optionally provide resume_message to show a visible agent self-resume after startup and begin a new inbound turn from it.",
  `${RESTART_HINT} Call this as the LAST tool in a turn after deploying new code.`,
  "Do NOT call exit_process in the middle of a multi-step turn — only when you are done and ready to restart.",
].join("\n");

function buildFailure(reason: string | null, message: string): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text: message }],
    details: {
      tool: "exit_process",
      scheduled: false,
      reason,
      error: message,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export const exitProcess: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${HINT}`,
  }));

  pi.registerTool({
    name: "exit_process",
    label: "exit_process",
    description: `Gracefully terminate piclaw (drain queue, persist sessions, stop services). A non-empty reason is required and posted to the active chat first. An optional resume_message is shown after startup and starts a new inbound turn. ${RESTART_HINT} Call as the LAST tool in a turn after deploying new code.`,
    promptSnippet: `exit_process: gracefully terminate piclaw after posting a visible restart notice. Requires a non-empty reason; optional resume_message visibly resumes work after startup. ${RESTART_HINT} Call LAST in a turn.`,
    parameters: ExitProcessSchema,
    async execute(_toolCallId, params: ExitProcessParams) {
      const reason = typeof params.reason === "string" ? params.reason.trim() : "";
      if (!reason) {
        return buildFailure(null, "A non-empty reason is required; shutdown was not scheduled.");
      }

      const hasResumeMessage = params.resume_message !== undefined;
      const resumeMessage = typeof params.resume_message === "string" ? params.resume_message.trim() : "";
      if (hasResumeMessage && !resumeMessage) {
        return buildFailure(reason, "resume_message must be non-empty when supplied; shutdown was not scheduled.");
      }

      const chatJid = getChatJid("");
      if (!chatJid) {
        return buildFailure(reason, "Cannot determine the active chat; shutdown was not scheduled.");
      }

      const otherActive = getActiveSessionCount(chatJid);
      if (otherActive > 0) {
        return buildFailure(
          reason,
          `${otherActive} other session(s) are active; shutdown was not scheduled. Wait for them to finish and call exit_process again.`,
        );
      }

      let handoff: RestartHandoff;
      try {
        handoff = prepareRestartHandoff({
          chatJid,
          reason,
          resumeMessage: resumeMessage || null,
        });
      } catch (error) {
        log.error("Failed to persist restart handoff", {
          operation: "exit_process.persist_handoff",
          chatJid,
          reason,
          hasResumeMessage,
          err: error,
        });
        return buildFailure(reason, "Failed to persist the restart handoff; shutdown was not scheduled.");
      }

      const discardHandoff = (): void => {
        try {
          deleteRestartHandoff(handoff.restartId);
        } catch (error) {
          log.error("Failed to discard incomplete restart handoff", {
            operation: "exit_process.discard_handoff",
            chatJid,
            reason,
            restartId: handoff.restartId,
            err: error,
          });
        }
      };

      const restartMessage = `Restarting now — Reason: ${reason}`;
      let postResult: AgentToolResult<Record<string, unknown>>;
      try {
        postResult = postMessagesToolMessage({
          action: "post",
          type: "agent",
          chat_jid: chatJid,
          content: restartMessage,
          content_blocks: [buildRestartHandoffMarker(handoff.restartId, "notice", { reason })],
        }, chatJid);
      } catch (error) {
        discardHandoff();
        log.error("Failed to post restart notice", {
          operation: "exit_process.post_notice",
          chatJid,
          reason,
          restartId: handoff.restartId,
          err: error,
        });
        return buildFailure(reason, "Failed to post the restart notice; shutdown was not scheduled.");
      }

      const postDetails = isRecord(postResult.details) ? postResult.details : {};
      if (postDetails.posted !== 1 || typeof postDetails.row_id !== "number" || postDetails.row_id <= 0) {
        discardHandoff();
        log.warn("Restart notice was not stored", {
          operation: "exit_process.post_notice",
          chatJid,
          reason,
          restartId: handoff.restartId,
          postDetails,
        });
        return buildFailure(reason, "Failed to store the restart notice; shutdown was not scheduled.");
      }

      try {
        handoff = markRestartHandoffReady(handoff, postDetails.row_id);
      } catch (error) {
        discardHandoff();
        log.error("Failed to mark restart handoff ready", {
          operation: "exit_process.ready_handoff",
          chatJid,
          reason,
          restartId: handoff.restartId,
          err: error,
        });
        return buildFailure(reason, "Failed to finalize the restart handoff; shutdown was not scheduled.");
      }

      log.info("Restart notice and handoff persisted; killing tracked subprocesses and marking pending shutdown", {
        reason,
        chatJid,
        restartId: handoff.restartId,
        restartMessageRowId: postDetails.row_id,
        hasResumeMessage: Boolean(handoff.resumeMessage),
        otherActiveSessions: otherActive,
      });
      const killed = killTrackedProcesses();

      // Mark the shutdown only after the agent-owned notice is stored. The
      // actual exit happens after finalization has flushed timeline events.
      markPendingShutdown(reason, chatJid, () => getActiveSessionCount(chatJid) === 0);

      return {
        content: [{ type: "text", text: `Restart notice posted. Graceful shutdown scheduled. ${killed} subprocess${killed === 1 ? "" : "es"} killed. ${RESTART_HINT} Reason: ${reason}` }],
        details: {
          tool: "exit_process",
          scheduled: true,
          killed_subprocesses: killed,
          other_active_sessions: otherActive,
          reason,
          chat_jid: chatJid,
          restart_id: handoff.restartId,
          resume_message: handoff.resumeMessage,
          restart_message: restartMessage,
          restart_message_row_id: postDetails.row_id,
          restart_message_broadcast: postDetails.broadcast === true,
        },
        terminate: true,
      } satisfies AgentToolResult<Record<string, unknown>>;
    },
  });
};
