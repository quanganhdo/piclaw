/**
 * web/handlers/general-settings.ts — Persist/apply General settings from the web UI.
 */

import {
  getSessionIsolationLevel,
  setSessionIsolationLevel,
  type SessionIsolationLevel,
} from "../../../extensions/session-status.js";
import {
  getIdentityConfig,
  getOrCreateWebWidgetToken,
  getSessionStorageConfig,
  getRecoveryPolicyConfig,
  getToolUseBudget,
  getWebRuntimeConfig,
  getSearchMatchMode,
  getScopedModelsOnly,
  setAssistantAvatar,
  setAssistantName,
  setSessionStorageConfig,
  setAutomaticRecoveryPolicyConfig,
  setToolUseBudget,
  getToolOutputStoreThreshold,
  setToolOutputStoreThreshold,
  setSearchMatchMode,
  setScopedModelsOnly,
  setUserAvatar,
  setUserAvatarBackground,
  setUserName,
  rotateWebWidgetToken,
  setWebComposeUploadLimitMb,
  setWebTerminalEnabled,
  setWebWorkspaceUploadLimitMb,
  type SearchMatchMode,
} from "../../../core/config.js";
import { generateTotpQr } from "../../../utils/totp-qr.js";
import { getAutomaticRecoveryConfig } from "../../../agent-pool/automatic-recovery.js";
import { getAgentRuntimeConfig } from "../../../core/config.js";
import { ensureAvatarCache, resolveAvatarUrl, type AvatarKind } from "../media/avatar-service.js";
import { getServerUiOutputConfig, getServerUiThemeConfig, setServerUiOutputConfig, setServerUiThemeConfig } from "../ui-state.js";

export interface GeneralSettingsData {
  assistantName: string;
  assistantAvatar: string;
  userName: string;
  userAvatar: string;
  userAvatarBackground: string;
  sessionAutoRotate: boolean;
  sessionMaxSizeMb: number;
  sessionMaxLines: number;
  webTerminalEnabled: boolean;
  composeUploadLimitMb: number;
  workspaceUploadLimitMb: number;
  toolUseBudget: number;
  toolOutputStoreThreshold: number;
  sessionMaxCompactions: number;
  instanceTotp: {
    configured: boolean;
    issuer: string;
    label: string;
    secret: string;
    otpauth: string;
    qrSvg: string;
  };
  sessionIsolation: "none" | "summary" | "full";
  searchMatchMode: "or" | "and";
  scopedModelsOnly: boolean;
  automaticRecoveryEnabled: boolean;
  automaticRecoveryMaxAttempts: number;
  automaticRecoveryTotalBudgetMs: number;
  automaticRecoveryEffectiveBudgetMs: number;
  uiTheme: string;
  uiTint: string | null;
  outputPad: number;
  widgetToken: string;
}

export interface GeneralSettingsInput {
  assistantName?: unknown;
  assistantAvatar?: unknown;
  userName?: unknown;
  userAvatar?: unknown;
  sessionAutoRotate?: unknown;
  sessionMaxSizeMb?: unknown;
  sessionMaxLines?: unknown;
  webTerminalEnabled?: unknown;
  composeUploadLimitMb?: unknown;
  workspaceUploadLimitMb?: unknown;
  toolUseBudget?: unknown;
  toolOutputStoreThreshold?: unknown;
  sessionMaxCompactions?: unknown;
  sessionIsolation?: unknown;
  searchMatchMode?: unknown;
  scopedModelsOnly?: unknown;
  automaticRecoveryEnabled?: unknown;
  automaticRecoveryMaxAttempts?: unknown;
  automaticRecoveryTotalBudgetMs?: unknown;
  uiTheme?: unknown;
  uiTint?: unknown;
  outputPad?: unknown;
}

export interface GeneralSettingsProfileUpdatePayload {
  agent_id: "default";
  agent_name: string;
  agent_avatar: string | null;
  user_name: string | null;
  user_avatar: string | null;
  user_avatar_background: string | null;
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function shouldPrecacheAvatarSource(source: string | null | undefined): source is string {
  const raw = String(source || "").trim();
  return Boolean(raw && !raw.startsWith("http://") && !raw.startsWith("https://"));
}

async function maybePrecacheAvatar(kind: AvatarKind, source: string | null | undefined): Promise<void> {
  if (!shouldPrecacheAvatarSource(source)) return;
  const cached = await ensureAvatarCache(kind, source);
  if (!cached?.file) {
    throw new Error(`Failed to prepare ${kind} avatar image.`);
  }
}

function withAvatarVersion(url: string | null, version: string): string | null {
  if (!url) return null;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

export function buildGeneralSettingsProfileUpdate(
  settings: GeneralSettingsData,
  version = String(Date.now()),
): GeneralSettingsProfileUpdatePayload {
  return {
    agent_id: "default",
    agent_name: settings.assistantName || "PiClaw",
    agent_avatar: withAvatarVersion(resolveAvatarUrl("agent", settings.assistantAvatar), version),
    user_name: settings.userName || null,
    user_avatar: withAvatarVersion(resolveAvatarUrl("user", settings.userAvatar), version),
    user_avatar_background: settings.userAvatarBackground || null,
  };
}

function buildTotpSettingsData(): GeneralSettingsData["instanceTotp"] {
  const identity = getIdentityConfig();
  const web = getWebRuntimeConfig();
  const secret = (web.totpSecret || "").trim();
  const issuer = identity.assistantName || "Piclaw";
  const label = identity.userName ? `${issuer}:${identity.userName}` : issuer;

  if (!secret) {
    return {
      configured: false,
      issuer,
      label,
      secret: "",
      otpauth: "",
      qrSvg: "",
    };
  }

  const qr = generateTotpQr({ secret, issuer, label });
  return {
    configured: true,
    issuer: qr.issuer,
    label: qr.label,
    secret: qr.secret,
    otpauth: qr.otpauth,
    qrSvg: qr.svg,
  };
}

export function getGeneralSettingsData(): GeneralSettingsData {
  const identity = getIdentityConfig();
  const session = getSessionStorageConfig();
  const web = getWebRuntimeConfig();
  const recovery = getRecoveryPolicyConfig();
  const uiTheme = getServerUiThemeConfig();
  const uiOutput = getServerUiOutputConfig();
  return {
    assistantName: identity.assistantName || "PiClaw",
    assistantAvatar: identity.assistantAvatar || "",
    userName: identity.userName || "",
    userAvatar: identity.userAvatar || "",
    userAvatarBackground: identity.userAvatarBackground || "",
    sessionAutoRotate: session.autoRotate,
    sessionMaxSizeMb: session.maxSizeMb,
    sessionMaxLines: session.maxLines,
    webTerminalEnabled: web.terminalEnabled,
    composeUploadLimitMb: web.composeUploadLimitMb,
    workspaceUploadLimitMb: web.workspaceUploadLimitMb,
    toolUseBudget: getToolUseBudget(),
    toolOutputStoreThreshold: getToolOutputStoreThreshold(),
    sessionMaxCompactions: session.maxCompactionsBeforeRotation,
    instanceTotp: buildTotpSettingsData(),
    sessionIsolation: getSessionIsolationLevel(),
    searchMatchMode: getSearchMatchMode(),
    scopedModelsOnly: getScopedModelsOnly(),
    automaticRecoveryEnabled: recovery.automaticRecoveryEnabled,
    automaticRecoveryMaxAttempts: recovery.automaticRecoveryMaxAttempts,
    automaticRecoveryTotalBudgetMs: recovery.automaticRecoveryTotalBudgetMs,
    automaticRecoveryEffectiveBudgetMs: getAutomaticRecoveryConfig(undefined, getAgentRuntimeConfig().timeoutMs).totalBudgetMs,
    uiTheme: uiTheme.theme,
    uiTint: uiTheme.tint,
    outputPad: uiOutput.outputPad,
    widgetToken: getOrCreateWebWidgetToken(),
  };
}

export function rotateWidgetTokenSettings(): GeneralSettingsData {
  rotateWebWidgetToken();
  return getGeneralSettingsData();
}

export async function saveGeneralSettings(input: GeneralSettingsInput): Promise<GeneralSettingsData> {
  const nextAssistantName = normalizeOptionalString(input.assistantName);
  if (nextAssistantName !== undefined) {
    setAssistantName(nextAssistantName || "PiClaw");
  }

  const nextAssistantAvatar = normalizeOptionalString(input.assistantAvatar);
  if (nextAssistantAvatar !== undefined) {
    const effectiveAvatar = nextAssistantAvatar || "";
    setAssistantAvatar(effectiveAvatar);
    await maybePrecacheAvatar("agent", effectiveAvatar);
  }

  const nextUserName = normalizeOptionalString(input.userName);
  if (nextUserName !== undefined) {
    setUserName(nextUserName || "");
  }

  const nextUserAvatar = normalizeOptionalString(input.userAvatar);
  if (nextUserAvatar !== undefined) {
    const effectiveAvatar = nextUserAvatar || "";
    setUserAvatar(effectiveAvatar);
    await maybePrecacheAvatar("user", effectiveAvatar);
    if (nextUserAvatar === null) {
      setUserAvatarBackground("");
    }
  }

  const sessionPatch: { maxSizeMb?: number; maxLines?: number; maxCompactionsBeforeRotation?: number; autoRotate?: boolean } = {};
  const nextSessionMaxSizeMb = normalizeOptionalInt(input.sessionMaxSizeMb, 1, 256);
  if (nextSessionMaxSizeMb !== undefined) {
    sessionPatch.maxSizeMb = nextSessionMaxSizeMb;
  }
  const nextSessionMaxLines = normalizeOptionalInt(input.sessionMaxLines, 100, 50000);
  if (nextSessionMaxLines !== undefined) {
    sessionPatch.maxLines = nextSessionMaxLines;
  }
  const nextSessionAutoRotate = normalizeOptionalBoolean(input.sessionAutoRotate);
  if (nextSessionAutoRotate !== undefined) {
    sessionPatch.autoRotate = nextSessionAutoRotate;
  }
  if (Object.keys(sessionPatch).length > 0) {
    setSessionStorageConfig(sessionPatch);
  }

  const nextWebTerminalEnabled = normalizeOptionalBoolean(input.webTerminalEnabled);
  if (nextWebTerminalEnabled !== undefined) {
    setWebTerminalEnabled(nextWebTerminalEnabled);
  }

  const nextComposeUploadLimitMb = normalizeOptionalInt(input.composeUploadLimitMb, 1, 512);
  if (nextComposeUploadLimitMb !== undefined) {
    setWebComposeUploadLimitMb(nextComposeUploadLimitMb);
  }

  const nextWorkspaceUploadLimitMb = normalizeOptionalInt(input.workspaceUploadLimitMb, 1, 1024);
  if (nextWorkspaceUploadLimitMb !== undefined) {
    setWebWorkspaceUploadLimitMb(nextWorkspaceUploadLimitMb);
  }

  const nextToolUseBudget = normalizeOptionalInt(input.toolUseBudget, 8, 512);
  if (nextToolUseBudget !== undefined) {
    setToolUseBudget(nextToolUseBudget);
  }

  const nextToolOutputThreshold = normalizeOptionalInt(input.toolOutputStoreThreshold, 500, 100000);
  if (nextToolOutputThreshold !== undefined) {
    setToolOutputStoreThreshold(nextToolOutputThreshold);
  }

  const nextMaxCompactions = normalizeOptionalInt(input.sessionMaxCompactions, 1, 20);
  if (nextMaxCompactions !== undefined) {
    sessionPatch.maxCompactionsBeforeRotation = nextMaxCompactions;
  }

  const nextSessionIsolation = typeof input.sessionIsolation === "string" ? input.sessionIsolation.trim().toLowerCase() : undefined;
  if (nextSessionIsolation === "none" || nextSessionIsolation === "summary" || nextSessionIsolation === "full") {
    setSessionIsolationLevel(nextSessionIsolation as SessionIsolationLevel);
  }

  const nextSearchMatchMode = typeof input.searchMatchMode === "string" ? input.searchMatchMode.trim().toLowerCase() : undefined;
  if (nextSearchMatchMode === "or" || nextSearchMatchMode === "and") {
    setSearchMatchMode(nextSearchMatchMode as SearchMatchMode);
  }

  const nextScopedModelsOnly = normalizeOptionalBoolean(input.scopedModelsOnly);
  if (nextScopedModelsOnly !== undefined) {
    setScopedModelsOnly(nextScopedModelsOnly);
  }

  const recoveryPatch: Parameters<typeof setAutomaticRecoveryPolicyConfig>[0] = {};
  const nextAutomaticRecoveryEnabled = normalizeOptionalBoolean(input.automaticRecoveryEnabled);
  if (nextAutomaticRecoveryEnabled !== undefined) recoveryPatch.automaticRecoveryEnabled = nextAutomaticRecoveryEnabled;
  if (input.automaticRecoveryMaxAttempts !== undefined) {
    const value = Number(input.automaticRecoveryMaxAttempts);
    if (!Number.isInteger(value) || value < 0) throw new Error("automaticRecoveryMaxAttempts must be a non-negative integer");
    recoveryPatch.automaticRecoveryMaxAttempts = value;
  }
  if (input.automaticRecoveryTotalBudgetMs !== undefined) {
    const value = Number(input.automaticRecoveryTotalBudgetMs);
    if (!Number.isInteger(value) || value < 0) throw new Error("automaticRecoveryTotalBudgetMs must be a non-negative integer");
    recoveryPatch.automaticRecoveryTotalBudgetMs = value;
  }
  if (Object.keys(recoveryPatch).length > 0) setAutomaticRecoveryPolicyConfig(recoveryPatch);

  const nextUiTheme = typeof input.uiTheme === "string" ? input.uiTheme.trim().toLowerCase() : undefined;
  const nextUiTint = input.uiTint === undefined
    ? undefined
    : (typeof input.uiTint === "string" && input.uiTint.trim())
      ? input.uiTint.trim()
      : null;
  if (nextUiTheme !== undefined || nextUiTint !== undefined) {
    setServerUiThemeConfig({
      ...(nextUiTheme !== undefined ? { theme: nextUiTheme || "default" } : {}),
      ...(nextUiTint !== undefined ? { tint: nextUiTint } : {}),
    });
  }

  const nextOutputPad = normalizeOptionalInt(input.outputPad, 0, 24);
  if (nextOutputPad !== undefined) {
    setServerUiOutputConfig({ outputPad: nextOutputPad });
  }

  return getGeneralSettingsData();
}
