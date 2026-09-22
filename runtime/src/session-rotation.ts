/**
 * session-rotation.ts – Shared session rotation helpers.
 *
 * Provides a single safe rotation implementation used by both the manual
 * control command (`/session-rotate`) and automatic rotation in AgentPool.
 */

import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentSession, AgentSessionRuntime, SessionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, extname, join } from "path";
import { formatBytes } from "./agent-control/agent-control-helpers.js";
import { runCompactionWithTimeout } from "./agent-pool/compaction.js";
import { createSessionManagerPersistencePort, type SessionEntryAppendPort, type SessionManagerLike } from "./agent-pool/session-persistence.js";
import { createLogger, debugSuppressedError } from "./utils/logger.js";
import { writeMergedSessionArchive } from "./session-archive.js";
import { getSessionThinkingPolicy, THINKING_POLICY_ENTRY } from "./agent-pool/thinking-policy.js";

const log = createLogger("session-rotation");

type PersistableSessionMessage = Parameters<SessionManager["appendMessage"]>[0];
type RotationModel = { provider: string; modelId: string };

/** Rotation trigger source. */
export type SessionRotationReason = "manual" | "automatic";

/** Result returned by shared rotation helpers. */
export interface SessionRotationResult {
  status: "success" | "error";
  reason: SessionRotationReason;
  message: string;
  archivePath?: string;
  newSessionFile?: string;
  previousSize?: number | null;
  nextSize?: number | null;
  compacted: boolean;
  emergencyFallback?: boolean;
}

export interface SessionRotationOptions {
  instructions?: string;
  reason?: SessionRotationReason;
  /** Continue with a lossy summary-only successor if the pre-rotation compaction fails. */
  fallbackOnCompactionFailure?: boolean;
  /** Skip model compaction entirely and create a lossy summary-only successor. */
  skipCompaction?: boolean;
  /** Human-readable reason included in summary-only emergency successors. */
  emergencyReason?: string;
  /** Chat JID used to scope compaction timeout/single-flight state and logs. */
  chatJid?: string;
}

/** Default compaction prompt used before a rotation handoff. */
export const ROTATION_COMPACTION_INSTRUCTIONS = [
  "Prepare a concise continuity summary for session rotation.",
  "Preserve active goals, decisions, constraints, user preferences, and any pending work relevant to the next turns.",
  "Prefer compact operational context over narrative detail.",
].join(" ");

/** Return the byte size for a persisted session file, or null if unavailable. */
export function getSessionFileSize(sessionFile: string | undefined): number | null {
  if (!sessionFile) return null;
  try {
    return statSync(sessionFile).size;
  } catch {
    return null;
  }
}

/** Return the line count for a persisted session file, or null if unavailable. */
export function getSessionFileLineCount(sessionFile: string | undefined): number | null {
  if (!sessionFile) return null;
  try {
    const content = readFileSync(sessionFile, "utf8");
    if (!content) return 0;
    // Each JSONL entry is one line; count newlines for a fast approximation.
    let count = 0;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) count++;
    }
    return count;
  } catch {
    return null;
  }
}

/** Choose a unique archive path inside the current session directory. */
export function getArchivePath(sessionFile: string): string {
  const archiveDir = join(dirname(sessionFile), "archive");
  mkdirSync(archiveDir, { recursive: true });

  const base = basename(sessionFile);
  const extension = extname(base);
  const stem = extension ? base.slice(0, -extension.length) : base;

  let candidate = join(archiveDir, base);
  let counter = 1;
  while (existsSync(candidate)) {
    candidate = join(archiveDir, `${stem}.archived-${counter}${extension}`);
    counter += 1;
  }
  return candidate;
}

/** Persist the current session entries immediately, even before another assistant response arrives. */
export function forcePersistSessionFile(session: AgentSession): string | null {
  const sessionFile = session.sessionFile;
  const header = session.sessionManager.getHeader();
  if (!sessionFile || !header) return null;

  mkdirSync(dirname(sessionFile), { recursive: true });
  const entries = session.sessionManager.getEntries();
  const content = [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n");
  const tempPath = `${sessionFile}.persisting-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, `${content}\n`, { flag: "wx" });
    renameSync(tempPath, sessionFile);
    return sessionFile;
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

/** Return true when compaction errors are safe to fall back from during rotation. */
export function isRotationFallbackCompactionError(message: string): boolean {
  return [
    "Already compacted",
    "Nothing to compact (session too small)",
    "No model selected",
  ].includes(message);
}

/** Build a carried-forward summary from compaction and branch-summary messages. */
export function collectCarriedSummary(messages: readonly AgentMessage[]): { summary: string | null; tokensBefore: number } {
  const parts: string[] = [];
  let tokensBefore = 0;

  for (const message of messages) {
    if (message.role === "compactionSummary") {
      parts.push(message.summary.trim());
      tokensBefore = Math.max(tokensBefore, message.tokensBefore);
    } else if (message.role === "branchSummary") {
      parts.push(`Branch summary:\n${message.summary.trim()}`);
    }
  }

  const summary = parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
  return {
    summary: summary || null,
    tokensBefore,
  };
}

/** Seed a freshly-created session from the current effective session context. */
export async function seedRotatedSession(
  sessionManager: SessionManager | SessionEntryAppendPort,
  context: SessionContext,
  options: {
    sessionName?: string;
    model?: RotationModel | null;
    thinkingLevel?: ThinkingLevel | null;
    preferredThinkingLevel?: ThinkingLevel | null;
  }
): Promise<void> {
  const persistence = "getEntries" in sessionManager
    ? createSessionManagerPersistencePort(sessionManager as unknown as SessionManagerLike)
    : sessionManager as SessionEntryAppendPort;
  if (options.sessionName?.trim()) await persistence.appendSessionInfo(options.sessionName.trim());
  if (options.model) await persistence.appendModelChange(options.model.provider, options.model.modelId);
  if (options.thinkingLevel) await persistence.appendThinkingLevelChange(options.thinkingLevel);
  if (options.preferredThinkingLevel) await persistence.appendCustomEntry(THINKING_POLICY_ENTRY, { preferred: options.preferredThinkingLevel });

  const carried = collectCarriedSummary(context.messages);
  if (carried.summary) await persistence.appendCompaction(carried.summary, "rotated-context", carried.tokensBefore);

  for (const message of context.messages) {
    if (message.role === "compactionSummary" || message.role === "branchSummary") {
      continue;
    }

    if (message.role === "custom") {
      await persistence.appendCustomMessageEntry(
        message.customType,
        message.content,
        message.display,
        message.details
      );
      continue;
    }

    await persistence.appendMessage(message as PersistableSessionMessage);
  }
}

const EMERGENCY_RECENT_MESSAGE_LIMIT = 32;
const EMERGENCY_MESSAGE_CHAR_LIMIT = 800;
const EMERGENCY_SUMMARY_CHAR_LIMIT = 16_000;

function truncateForEmergencySummary(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function extractVisibleText(message: AgentMessage): string {
  const content = (message as AgentMessage & { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const type = (block as { type?: unknown }).type;
    if (type !== "text") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) parts.push(text);
  }
  return parts.join("\n");
}

export function buildEmergencyRotationSummary(
  context: SessionContext,
  options: {
    reason?: string | null;
    previousSessionFile?: string | null;
    archivePath?: string | null;
  } = {},
): { summary: string; tokensBefore: number; recentMessageCount: number } {
  const carried = collectCarriedSummary(context.messages);
  const parts: string[] = [
    "# Emergency session rotation handoff",
    "Compaction failed or was skipped, so Piclaw archived the bloated session and started a lean successor instead of carrying the oversized context forward.",
  ];
  if (options.reason?.trim()) parts.push(`Reason: ${truncateForEmergencySummary(options.reason, 500)}`);
  if (options.archivePath?.trim()) parts.push(`Archived full session: ${options.archivePath.trim()}`);
  else if (options.previousSessionFile?.trim()) parts.push(`Previous session file: ${options.previousSessionFile.trim()}`);

  if (carried.summary) {
    parts.push("\n## Existing compacted context", truncateForEmergencySummary(carried.summary, EMERGENCY_SUMMARY_CHAR_LIMIT));
  }

  const visibleMessages = context.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, text: truncateForEmergencySummary(extractVisibleText(message), EMERGENCY_MESSAGE_CHAR_LIMIT) }))
    .filter((message) => message.text.length > 0)
    .slice(-EMERGENCY_RECENT_MESSAGE_LIMIT);

  if (visibleMessages.length > 0) {
    parts.push("\n## Recent visible conversation");
    for (const message of visibleMessages) {
      parts.push(`- ${message.role.toUpperCase()}: ${message.text}`);
    }
  }

  parts.push("\n## Notes", "- Assistant thinking, encrypted reasoning signatures, tool calls, and full tool results were intentionally dropped from the successor session.", "- Use the archived session file only if deep forensic context is required.");

  const summary = parts.join("\n").trim();
  const tokensBefore = carried.tokensBefore || Math.ceil(JSON.stringify(context.messages).length / 4);
  return { summary, tokensBefore, recentMessageCount: visibleMessages.length };
}

export async function seedEmergencyRotatedSession(
  sessionManager: SessionManager | SessionEntryAppendPort,
  context: SessionContext,
  options: {
    sessionName?: string;
    model?: RotationModel | null;
    thinkingLevel?: ThinkingLevel | null;
    preferredThinkingLevel?: ThinkingLevel | null;
    reason?: string | null;
    previousSessionFile?: string | null;
    archivePath?: string | null;
  },
): Promise<void> {
  const persistence = "getEntries" in sessionManager
    ? createSessionManagerPersistencePort(sessionManager as unknown as SessionManagerLike)
    : sessionManager as SessionEntryAppendPort;
  if (options.sessionName?.trim()) await persistence.appendSessionInfo(options.sessionName.trim());
  if (options.model) await persistence.appendModelChange(options.model.provider, options.model.modelId);
  if (options.thinkingLevel) await persistence.appendThinkingLevelChange(options.thinkingLevel);
  if (options.preferredThinkingLevel) await persistence.appendCustomEntry(THINKING_POLICY_ENTRY, { preferred: options.preferredThinkingLevel });

  const emergency = buildEmergencyRotationSummary(context, options);
  await persistence.appendCompaction(emergency.summary, "emergency-rotation", emergency.tokensBefore);
}

interface RotationRestoreResult {
  restored: boolean;
  message: string | null;
  replacementSessionFile: string | null;
}

async function restorePreviousRotationSession(
  runtime: AgentSessionRuntime,
  previousSessionFile: string,
  reason: "cancellation" | "failure",
): Promise<RotationRestoreResult> {
  const replacementSessionFile = runtime.session.sessionFile?.trim() || null;
  if (!replacementSessionFile || replacementSessionFile === previousSessionFile) {
    return { restored: true, message: null, replacementSessionFile: null };
  }

  try {
    const result = await runtime.switchSession(previousSessionFile);
    if (result.cancelled) {
      return {
        restored: false,
        replacementSessionFile,
        message: `Failed to restore previous session after ${reason}: ${previousSessionFile}`,
      };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      restored: false,
      replacementSessionFile,
      message: `Failed to restore previous session after ${reason}: ${detail}`,
    };
  }

  const restoredSessionFile = runtime.session.sessionFile?.trim();
  if (restoredSessionFile !== previousSessionFile) {
    return {
      restored: false,
      replacementSessionFile,
      message: `Failed to restore previous session after ${reason}: expected ${previousSessionFile} but active session is ${restoredSessionFile || "(none)"}`,
    };
  }

  return { restored: true, message: null, replacementSessionFile };
}

function cleanupInactiveReplacementSessionFile(
  runtime: AgentSessionRuntime,
  replacementSessionFile: string | null,
  previousSessionFile: string,
): void {
  if (!replacementSessionFile || replacementSessionFile === previousSessionFile) return;
  const activeSessionFile = runtime.session.sessionFile?.trim() || null;
  if (activeSessionFile === replacementSessionFile) return;
  try {
    rmSync(replacementSessionFile, { recursive: true, force: true });
  } catch (error) {
    debugSuppressedError(log, "Failed to cleanup inactive replacement session file after rotation rollback.", error, {
      operation: "session_rotation.cleanup_replacement_session_file",
      replacementSessionFile,
      previousSessionFile,
    });
  }
}

export function syncRotatedSessionModel(session: AgentSession, model: RotationModel | null): boolean {
  if (!model) return false;
  const sessionLike = session as AgentSession & {
    agent?: { state?: { model?: unknown } };
  };
  if (!sessionLike.modelRuntime || !sessionLike.agent?.state) return false;

  let resolvedModel: any;
  try {
    resolvedModel = sessionLike.modelRuntime.getModel(model.provider, model.modelId);
  } catch {
    return false;
  }
  if (!resolvedModel) {
    log.warn("Unable to sync rotated session model because it is not registered", {
      operation: "session_rotation.sync_model_missing",
      provider: model.provider,
      modelId: model.modelId,
    });
    return false;
  }
  if (!sessionLike.modelRuntime.hasConfiguredAuth(resolvedModel.provider)) {
    log.warn("Unable to sync rotated session model because it has no configured auth", {
      operation: "session_rotation.sync_model_no_auth",
      provider: model.provider,
      modelId: model.modelId,
    });
    return false;
  }

  const previous = session.model ? `${session.model.provider}/${session.model.id}` : null;
  sessionLike.agent.state.model = resolvedModel;
  const next = `${resolvedModel.provider}/${resolvedModel.id}`;
  if (previous !== next) {
    log.info("Synced rotated session active model to carried context model", {
      operation: "session_rotation.sync_model",
      previous,
      next,
    });
  }
  return true;
}

/** Keep a successor session on the user's active thinking level after rotation. */
export function syncRotatedSessionThinkingLevel(session: AgentSession, thinkingLevel: ThinkingLevel | null): boolean {
  if (!thinkingLevel) return false;
  const sessionLike = session as AgentSession & {
    agent?: { state?: { thinkingLevel?: string } };
  };
  if (!sessionLike.agent?.state) return false;

  const previous = session.thinkingLevel ?? null;
  sessionLike.agent.state.thinkingLevel = thinkingLevel;
  if (previous !== thinkingLevel) {
    log.info("Synced rotated session thinking level to carried preference", {
      operation: "session_rotation.sync_thinking_level",
      previous,
      next: thinkingLevel,
    });
  }
  return true;
}

/** Rotate a persisted session into a newly-seeded successor session file. */
export async function rotateSession(
  session: AgentSession,
  runtime: AgentSessionRuntime,
  options: SessionRotationOptions = {}
): Promise<SessionRotationResult> {
  const reason = options.reason ?? "manual";

  if (session.isStreaming || session.isCompacting || session.isRetrying) {
    return {
      status: "error",
      reason,
      compacted: false,
      message: "Cannot rotate the session while a response, compaction, or retry is active.",
    };
  }

  if (session.pendingMessageCount > 0) {
    return {
      status: "error",
      reason,
      compacted: false,
      message: "Cannot rotate the session while queued steering or follow-up messages are pending.",
    };
  }

  const previousSessionId = session.sessionId;
  const previousSessionFile = session.sessionFile?.trim();
  if (!previousSessionFile) {
    return {
      status: "error",
      reason,
      compacted: false,
      message: "No persisted session file is active yet.",
    };
  }

  if (!existsSync(previousSessionFile)) {
    return {
      status: "error",
      reason,
      compacted: false,
      message: `Current session file does not exist: ${previousSessionFile}`,
    };
  }

  const compactionInstructions = options.instructions?.trim() || ROTATION_COMPACTION_INSTRUCTIONS;
  let compacted = false;
  let emergencyFallback = Boolean(options.skipCompaction);
  let emergencyReason = options.emergencyReason?.trim() || null;
  if (!options.skipCompaction) {
    const compactionResult = await runCompactionWithTimeout(
      session,
      options.chatJid ?? `session-rotation:${previousSessionId ?? previousSessionFile}`,
      { onWarn: (message, details) => log.warn(message, details) },
      async () => await session.compact(compactionInstructions),
      "rotation",
      { trigger: "rotation", willRetry: false, source: "session_rotation" },
    );
    if (compactionResult.ok) {
      compacted = true;
    } else {
      const message = compactionResult.errorMessage;
      if (!isRotationFallbackCompactionError(message)) {
        if (!options.fallbackOnCompactionFailure) {
          return { status: "error", reason, compacted, message };
        }
        emergencyFallback = true;
        emergencyReason = message;
      }
    }
  }

  const context = session.sessionManager.buildSessionContext();
  const priorTrimArchivePath = join(dirname(previousSessionFile), "archive", basename(previousSessionFile));
  const archivePath = getArchivePath(previousSessionFile);
  const previousSize = getSessionFileSize(previousSessionFile);
  const currentModel = session.model
    ? { provider: session.model.provider, modelId: session.model.id }
    : context.model;
  const currentThinkingLevel = session.thinkingLevel ?? context.thinkingLevel ?? null;
  const preferredThinkingLevel = getSessionThinkingPolicy(session)?.preferred_level ?? currentThinkingLevel;
  const currentSessionName = session.sessionName?.trim() || undefined;

  let archived = false;
  let committed = false;
  let replacementSessionFile: string | null = null;
  try {
    writeMergedSessionArchive(
      previousSessionFile,
      archivePath,
      existsSync(priorTrimArchivePath) ? priorTrimArchivePath : undefined,
    );
    archived = true;

    const result = await runtime.newSession({
      parentSession: archivePath,
      setup: async (sessionManager) => {
        if (emergencyFallback) {
          await seedEmergencyRotatedSession(sessionManager, context, {
            sessionName: currentSessionName,
            model: currentModel,
            thinkingLevel: currentThinkingLevel,
            preferredThinkingLevel,
            reason: emergencyReason,
            previousSessionFile,
            archivePath,
          });
          return;
        }
        await seedRotatedSession(sessionManager, context, {
          sessionName: currentSessionName,
          model: currentModel,
          thinkingLevel: currentThinkingLevel,
          preferredThinkingLevel,
        });
      },
    });
    replacementSessionFile = runtime.session.sessionFile?.trim() || null;

    if (result.cancelled) {
      if (archived) rmSync(archivePath, { force: true });
      const restore = await restorePreviousRotationSession(runtime, previousSessionFile, "cancellation");
      cleanupInactiveReplacementSessionFile(runtime, restore.replacementSessionFile ?? replacementSessionFile, previousSessionFile);
      return {
        status: "error",
        reason,
        compacted,
        message: restore.message ? `Session rotation cancelled. ${restore.message}` : "Session rotation cancelled.",
      };
    }

    let activeSession = runtime.session;
    replacementSessionFile = activeSession.sessionFile?.trim() || replacementSessionFile;
    syncRotatedSessionModel(activeSession, currentModel);
    syncRotatedSessionThinkingLevel(activeSession, currentThinkingLevel);
    const persistedSessionFile = forcePersistSessionFile(activeSession);
    if (persistedSessionFile) {
      const reopened = await runtime.switchSession(persistedSessionFile);
      if (reopened.cancelled) throw new Error("Rotated session could not be reopened after persistence.");
      activeSession = runtime.session;
    }
    closeOpenAICodexWebSocketSessions(previousSessionId);
    rmSync(previousSessionFile, { force: true });
    committed = true;

    const nextSessionFile = activeSession.sessionFile || "(unavailable)";
    const nextSize = getSessionFileSize(activeSession.sessionFile);
    const summaryCount = emergencyFallback ? 1 : collectCarriedSummary(context.messages).summary ? 1 : 0;
    const carriedMessageCount = emergencyFallback
      ? 0
      : context.messages.filter(
        (message) => message.role !== "compactionSummary" && message.role !== "branchSummary"
      ).length;

    return {
      status: "success",
      reason,
      compacted,
      emergencyFallback,
      archivePath,
      newSessionFile: nextSessionFile,
      previousSize,
      nextSize,
      message: [
        emergencyFallback
          ? (reason === "automatic" ? "Session emergency-rotated." : "Session emergency-rotated.")
          : (reason === "automatic" ? "Session auto-rotated." : "Session rotated."),
        `Archived previous session: ${archivePath}`,
        `New session: ${nextSessionFile}`,
        `Previous file size: ${previousSize === null ? "unknown" : formatBytes(previousSize)}`,
        `New file size: ${nextSize === null ? "unknown" : formatBytes(nextSize)}`,
        `Continuity seed: ${emergencyFallback ? "lossy emergency summary" : `${summaryCount > 0 ? "summary + " : ""}${carriedMessageCount} carried message${carriedMessageCount === 1 ? "" : "s"}`}`,
        `Compaction before rotate: ${compacted ? "yes" : emergencyFallback ? "no (emergency summary-only fallback)" : "no (used current effective context)"}`,
      ].join("\n"),
    };
  } catch (err) {
    let restoreMessage: string | null = null;
    if (!committed) {
      const restore = await restorePreviousRotationSession(runtime, previousSessionFile, "failure");
      restoreMessage = restore.message;
      cleanupInactiveReplacementSessionFile(runtime, restore.replacementSessionFile ?? replacementSessionFile, previousSessionFile);
      if (archived) {
        try {
          rmSync(archivePath, { force: true });
        } catch {
          /* expected: failed rotation cleanup is best-effort because the archive path may already be gone. */
        }
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", reason, compacted, message: restoreMessage ? `${message} ${restoreMessage}` : message };
  }
}
