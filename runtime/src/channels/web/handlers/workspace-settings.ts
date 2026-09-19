import {
  getWebRuntimeConfig,
  setWebTerminalEnabled,
  setWebVncAllowDirect,
  setWebSanitizeSvgFences,
} from "../../../core/config.js";
import {
  getWorkspaceScanSettings,
  saveWorkspaceScanSettings,
} from "../workspace/settings.js";

export interface WorkspaceSettingsData {
  webTerminalEnabled: boolean;
  vncAllowDirect: boolean;
  sanitizeSvgFences: boolean;
  treeMaxDepth: number;
  treeMaxEntries: number;
}

export interface WorkspaceSettingsInput {
  webTerminalEnabled?: unknown;
  vncAllowDirect?: unknown;
  sanitizeSvgFences?: unknown;
  treeMaxDepth?: unknown;
  treeMaxEntries?: unknown;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function getWorkspaceSettingsData(): WorkspaceSettingsData {
  const web = getWebRuntimeConfig();
  const scan = getWorkspaceScanSettings();
  return {
    webTerminalEnabled: web.terminalEnabled,
    vncAllowDirect: web.vncAllowDirect,
    sanitizeSvgFences: web.sanitizeSvgFences,
    treeMaxDepth: scan.treeMaxDepth,
    treeMaxEntries: scan.treeMaxEntries,
  };
}

export function saveWorkspaceSettings(input: WorkspaceSettingsInput): WorkspaceSettingsData {
  const nextWebTerminalEnabled = normalizeOptionalBoolean(input.webTerminalEnabled);
  if (nextWebTerminalEnabled !== undefined) {
    setWebTerminalEnabled(nextWebTerminalEnabled);
  }

  const nextVncAllowDirect = normalizeOptionalBoolean(input.vncAllowDirect);
  if (nextVncAllowDirect !== undefined) {
    setWebVncAllowDirect(nextVncAllowDirect);
  }

  const nextSanitizeSvgFences = normalizeOptionalBoolean(input.sanitizeSvgFences);
  if (nextSanitizeSvgFences !== undefined) {
    setWebSanitizeSvgFences(nextSanitizeSvgFences);
  }

  if (input.treeMaxDepth !== undefined || input.treeMaxEntries !== undefined) {
    saveWorkspaceScanSettings({
      treeMaxDepth: input.treeMaxDepth,
      treeMaxEntries: input.treeMaxEntries,
    });
  }

  return getWorkspaceSettingsData();
}
