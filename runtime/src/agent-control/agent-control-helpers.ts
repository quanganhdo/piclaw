/**
 * agent-control/agent-control-helpers.ts – Shared helpers for control handlers.
 *
 * Provides utility functions used across multiple handler modules:
 *   - THINKING_LEVELS constant array.
 *   - Shell command formatting (formatShellBlock, resolveShellCwd).
 *   - Session state inspection (getModelLabel, formatSessionState).
 *   - Config file persistence for identity changes.
 *   - Context usage and stats formatting.
 *
 * Consumers:
 *   - All handler modules under handlers/*.ts.
 *   - agent-pool.ts for model label resolution.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { existsSync } from "fs";
import { getConfigPath, WORKSPACE_DIR } from "../core/config.js";
import { readJsonConfig, writeJsonConfig } from "../core/config-store.js";
import { getChatJid } from "../core/chat-context.js";
import { isContextPressureFailure } from "../agent-pool/automatic-recovery.js";
import { finalizeRecoveryCompactionOutcome, runCompactionWithTimeout } from "../agent-pool/compaction.js";
import {
  didPromptAdvanceSession,
  getSessionLeafId,
  RECOVERY_CONTINUATION_PROMPT,
} from "../agent-pool/context-pressure-retry.js";

/** Ordered list of supported thinking levels from off to max. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type ThinkingLevelMapWithFutureLevels = Record<string, string | null | undefined>;
type ThinkingModelDescriptor = Pick<Model<Api>, "provider" | "reasoning" | "thinkingLevelMap">;

/**
 * Detect pre-0.80.6/custom model metadata that exposed provider `max` through
 * Pi's old `xhigh` slot. Native `max` must remain distinct when both exist.
 */
export function usesLegacyMaxThinkingAlias(model: ThinkingModelDescriptor | null | undefined): boolean {
  const thinkingLevelMap = model?.thinkingLevelMap as ThinkingLevelMapWithFutureLevels | undefined;
  return thinkingLevelMap?.xhigh === "max" && thinkingLevelMap.max == null;
}

/** Resolve the legacy `max` alias without collapsing native 0.80.6 `max`. */
export function resolveThinkingAlias(level: string, model: ThinkingModelDescriptor | null | undefined): string {
  return level === "max" && usesLegacyMaxThinkingAlias(model) ? "xhigh" : level;
}

/** Check if a provider uses "effort" terminology (e.g. Anthropic). */
export function isEffortProvider(provider: string | undefined | null): boolean {
  return provider?.toLowerCase() === "anthropic";
}

/** Display legacy `xhigh: max` metadata as max while preserving native xhigh. */
export function formatThinkingLevelForDisplay(level: string, model: ThinkingModelDescriptor | null | undefined): string {
  return level === "xhigh" && usesLegacyMaxThinkingAlias(model) ? "max" : level;
}

/**
 * Return Piclaw's view of model-supported thinking levels.
 *
 * Pi 0.80.x still exposes the historical `off..xhigh` type surface, while
 * provider metadata can already advertise native `max`. Merge explicit
 * thinkingLevelMap slots so UI/status/control paths can surface and preserve
 * native max without treating legacy `xhigh: max` aliases as the same thing.
 */
export function getAvailableThinkingLevelsForModel(
  model: ThinkingModelDescriptor | null | undefined,
  baseLevels?: readonly string[],
): string[] {
  if (!model?.reasoning) return ["off"];

  const levels: string[] = [];
  const add = (level: string | null | undefined) => {
    if (!level || levels.includes(level)) return;
    levels.push(level);
  };

  for (const level of baseLevels ?? getSupportedThinkingLevels(model as Model<Api>)) {
    add(level);
  }

  const thinkingLevelMap = model.thinkingLevelMap as ThinkingLevelMapWithFutureLevels | undefined;
  if (thinkingLevelMap) {
    for (const level of THINKING_LEVELS) {
      if (thinkingLevelMap[level] !== null && thinkingLevelMap[level] !== undefined) {
        add(level);
      }
    }
  }

  return levels.length > 0 ? levels : ["off"];
}

/** Set a thinking level, bypassing old Pi clamping when model metadata supports a newer slot. */
export function setSessionThinkingLevelCompat(session: AgentSession, level: string): string | null | undefined {
  const model = session.model as ThinkingModelDescriptor | null | undefined;
  const sessionAvailable = typeof session.getAvailableThinkingLevels === "function"
    ? session.getAvailableThinkingLevels() as readonly string[]
    : [];
  const piclawAvailable = getAvailableThinkingLevelsForModel(model, sessionAvailable);
  const needsCompatForce = level === "max" && Boolean(model?.reasoning) && piclawAvailable.includes(level) && !sessionAvailable.includes(level);

  if (!needsCompatForce) {
    session.setThinkingLevel(level as never);
    return session.thinkingLevel ?? null;
  }

  const forcedLevel = String(level);
  const previousLevel = (session.thinkingLevel ?? null) as string | null;
  const anySession = session as unknown as {
    agent?: { state?: { thinkingLevel?: string } };
    thinkingLevel?: string;
    sessionManager?: { appendThinkingLevelChange?: (thinkingLevel: string) => unknown };
    supportsThinking?: () => boolean;
    _emit?: (event: { type: string; level: string }) => unknown;
    _extensionRunner?: { emit?: (event: { type: string; level: string; previousLevel: string | null }) => unknown };
  };

  if (anySession.agent?.state) {
    anySession.agent.state.thinkingLevel = forcedLevel;
  }
  // Some AgentSession builds expose thinkingLevel through a getter only; Reflect.set
  // returns false instead of throwing for that fallback path.
  Reflect.set(anySession, "thinkingLevel", forcedLevel);

  if (previousLevel !== forcedLevel) {
    anySession.sessionManager?.appendThinkingLevelChange?.(forcedLevel);
    anySession._emit?.({ type: "thinking_level_changed", level: forcedLevel });
    void anySession._extensionRunner?.emit?.({ type: "thinking_level_select", level: forcedLevel, previousLevel });
  }

  return session.thinkingLevel ?? anySession.agent?.state?.thinkingLevel ?? anySession.thinkingLevel ?? null;
}

/** Return the preferred working directory for shell commands (configured workspace or cwd). */
export function resolveShellCwd(): string {
  if (existsSync(WORKSPACE_DIR)) return WORKSPACE_DIR;
  const legacyPreferred = "/workspace";
  if (existsSync(legacyPreferred)) return legacyPreferred;
  return process.cwd();
}

/** Format a shell command and its output as a markdown-style code block. */
export function formatShellBlock(command: string, output: string, meta: string[] = []): string {
  const lines: string[] = [`$ ${command}`];
  const trimmed = output.trimEnd();
  if (trimmed) {
    lines.push(trimmed);
  } else {
    lines.push("(no output)");
  }
  if (meta.length > 0) {
    lines.push(...meta);
  }
  return ["```", ...lines, "```"].join("\n");
}

/** Format a byte count using human-readable binary units. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return String(bytes);
  const abs = Math.abs(bytes);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = abs;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  const trimmed = formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted;
  return `${bytes < 0 ? "-" : ""}${trimmed} ${units[unitIndex]}`;
}

/** Format a number with K/M suffixes for compact display. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  const format = (divisor: number, suffix: string) => {
    const raw = (value / divisor).toFixed(1);
    const trimmed = raw.endsWith(".0") ? raw.slice(0, -2) : raw;
    return `${trimmed}${suffix}`;
  };
  if (abs >= 1_000_000_000) return format(1_000_000_000, "B");
  if (abs >= 1_000_000) return format(1_000_000, "M");
  if (abs >= 1_000) return format(1_000, "K");
  return String(value);
}

/** Format a number as a USD currency string. */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "$0";
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** Truncate text to maxLen characters, appending '…' if truncated. */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** Extract plain text from a pi-agent content block array. */
export function extractTextFromContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const textBlock = block as { type?: unknown; text?: unknown };
        if (textBlock.type !== "text") return "";
        return typeof textBlock.text === "string" ? textBlock.text : "";
      })
      .join("");
  }
  return "";
}

/** Persist assistant identity changes (name, avatar) to the config file. */
export function updateAssistantConfig(patch: { name?: string | null; avatar?: string | null }): {
  name?: string;
  avatar?: string;
} {
  const config = readJsonConfig(getConfigPath());
  const assistant =
    config.assistant && typeof config.assistant === "object"
      ? { ...(config.assistant as Record<string, unknown>) }
      : {};
  const nameKeys = ["assistantName", "assistant_name", "agentName", "agent_name", "name", "ASSISTANT_NAME"];
  const avatarKeys = [
    "assistantAvatar",
    "assistant_avatar",
    "agentAvatar",
    "agent_avatar",
    "avatar",
    "ASSISTANT_AVATAR",
  ];

  const clearKeys = (keys: string[]) => {
    for (const key of keys) {
      if (key in assistant) delete assistant[key];
    }
  };

  if (patch.name !== undefined) {
    clearKeys(nameKeys);
    if (patch.name !== null) {
      assistant.assistantName = patch.name;
    }
  }

  if (patch.avatar !== undefined) {
    clearKeys(avatarKeys);
    if (patch.avatar !== null) {
      assistant.assistantAvatar = patch.avatar;
    }
  }

  if (Object.keys(assistant).length > 0) {
    config.assistant = assistant;
  } else {
    delete config.assistant;
  }

  writeJsonConfig(getConfigPath(), config);

  return {
    name: typeof assistant.assistantName === "string" ? assistant.assistantName : undefined,
    avatar: typeof assistant.assistantAvatar === "string" ? assistant.assistantAvatar : undefined,
  };
}

/** Persist user identity changes (name, avatar, github) to the config file. */
export function updateUserConfig(patch: {
  name?: string | null;
  avatar?: string | null;
  avatarBackground?: string | null;
}): {
  name?: string;
  avatar?: string;
  avatarBackground?: string;
} {
  const config = readJsonConfig(getConfigPath());
  const user =
    config.user && typeof config.user === "object"
      ? { ...(config.user as Record<string, unknown>) }
      : {};
  const nameKeys = ["userName", "user_name", "name", "PICLAW_USER_NAME"];
  const avatarKeys = ["userAvatar", "user_avatar", "avatar", "PICLAW_USER_AVATAR"];
  const backgroundKeys = [
    "userAvatarBackground",
    "user_avatar_background",
    "userAvatarBg",
    "user_avatar_bg",
    "avatarBackground",
    "avatar_background",
    "PICLAW_USER_AVATAR_BACKGROUND",
  ];

  const clearKeys = (keys: string[]) => {
    for (const key of keys) {
      if (key in user) delete user[key];
    }
  };

  if (patch.name !== undefined) {
    clearKeys(nameKeys);
    if (patch.name !== null) {
      user.userName = patch.name;
    }
  }

  if (patch.avatar !== undefined) {
    clearKeys(avatarKeys);
    if (patch.avatar !== null) {
      user.userAvatar = patch.avatar;
    }
  }

  if (patch.avatarBackground !== undefined) {
    clearKeys(backgroundKeys);
    if (patch.avatarBackground !== null) {
      user.userAvatarBackground = patch.avatarBackground;
    }
  }

  if (Object.keys(user).length > 0) {
    config.user = user;
  } else {
    delete config.user;
  }

  writeJsonConfig(getConfigPath(), config);

  return {
    name: typeof user.userName === "string" ? user.userName : undefined,
    avatar: typeof user.userAvatar === "string" ? user.userAvatar : undefined,
    avatarBackground:
      typeof user.userAvatarBackground === "string" ? user.userAvatarBackground : undefined,
  };
}

/** Inject a prompt into the session and capture the streamed response text. */
export async function runPromptAndCapture(
  session: AgentSession,
  text: string,
  options?: { streamingBehavior?: "steer" | "followUp" }
): Promise<string> {
  let assistantBuffer = "";
  const customBuffers: string[] = [];
  let providerError: string | null;
  let compacted = false;
  let attemptText = text;

  const resetCapturedOutput = () => {
    assistantBuffer = "";
    customBuffers.length = 0;
  };

  const onEvent = (event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      const messageUpdate = event.assistantMessageEvent;
      if (messageUpdate?.type === "text_delta") {
        assistantBuffer += messageUpdate.delta || "";
      }
      return;
    }

    if (event.type !== "message_end") return;

    const message = event.message as { role?: unknown; content?: unknown; stopReason?: unknown; errorMessage?: unknown };
    if (message.role === "assistant" && message.stopReason === "error" && typeof message.errorMessage === "string" && message.errorMessage.trim()) {
      providerError = message.errorMessage.trim();
    }
    const text = extractTextFromContent(message.content);
    if (message.role === "assistant") {
      assistantBuffer = text || assistantBuffer;
    } else if (text) {
      customBuffers.push(text);
    }
  };

  const unsub = session.subscribe(onEvent);
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      providerError = null;
      const baselineLeafId = getSessionLeafId(session);
      try {
        await session.prompt(attemptText, options);
      } catch (error) {
        providerError = error instanceof Error ? error.message : String(error);
      }
      if (providerError && isContextPressureFailure(providerError) && !compacted) {
        const promptWasPersisted = didPromptAdvanceSession(session, baselineLeafId);
        const chatJid = getChatJid("control:prompt_capture");
        const compaction = await runCompactionWithTimeout(
          session,
          chatJid,
          {},
          async () => await session.compact(),
          "recovery",
          { trigger: "recovery", willRetry: true, source: "prompt_capture_context_pressure", attempt: attempt + 1 },
        );
        finalizeRecoveryCompactionOutcome(session, chatJid, compaction);
        if (!compaction.ok) throw new Error(compaction.errorMessage);
        compacted = true;
        attemptText = promptWasPersisted ? RECOVERY_CONTINUATION_PROMPT : attemptText;
        resetCapturedOutput();
        continue;
      }
      if (providerError) throw new Error(providerError);
      break;
    }
  } finally {
    unsub();
  }

  const finalText = (assistantBuffer && assistantBuffer.trim())
    ? assistantBuffer.trim()
    : customBuffers.join("\n\n").trim();

  return finalText || "(no output)";
}

/** Fuzzy-match a model input string against available models. */
export function normalizeModelMatch(
  models: Model<Api>[],
  provider: string,
  modelId: string
): Model<Api> | undefined {
  const providerLower = provider.toLowerCase();
  const modelLower = modelId.toLowerCase();
  return models.find((model) => model.provider.toLowerCase() === providerLower && model.id.toLowerCase() === modelLower);
}
