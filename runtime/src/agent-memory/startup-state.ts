import type Database from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve } from "path";

import { getWorkspaceDir } from "../core/config.js";
import { getDb } from "../db.js";
import { AUTO_DREAM_DEFAULT_DAYS } from "../dream-defaults.js";
import { inspectDailyNoteSummaryBacklog } from "./daily-notes.js";
import { refreshAgentMemoryFromDailyNotes, type RefreshAgentMemoryResult } from "./refresh.js";

const DERIVED_MEMORY_FILES = ["MEMORY.md", "current-state.md", "recent-context.md"] as const;
const STARTUP_MARKER_FILE = ".dream-state";

export type DreamWorkspaceStateKind = "fresh" | "established_complete" | "established_missing_derived";
export type DreamStartupRecoveryStatus = "complete" | "backfill_required";

export interface DreamWorkspaceState {
  kind: DreamWorkspaceStateKind;
  missingDerivedFiles: string[];
  hasNonDreamMessages: boolean | null;
  hasDailyNotes: boolean;
  initialized: boolean;
  backfillRequired: boolean;
  evidenceError: string | null;
}

export interface DreamStartupRecoveryResult {
  refresh: RefreshAgentMemoryResult;
  materializedFiles: string[];
  backfillRequired: boolean;
  markerChanged: boolean;
}

interface DreamStartupMarker {
  initialized: true;
  recovery: DreamStartupRecoveryStatus;
}

function getDreamMemoryDir(workspaceRoot = getWorkspaceDir()): string {
  return resolve(workspaceRoot, "notes", "memory");
}

function getDreamDailyDir(workspaceRoot = getWorkspaceDir()): string {
  return resolve(workspaceRoot, "notes", "daily");
}

export function getDreamDerivedMemoryFiles(workspaceRoot = getWorkspaceDir()): string[] {
  const memoryDir = getDreamMemoryDir(workspaceRoot);
  return DERIVED_MEMORY_FILES.map((file) => resolve(memoryDir, file));
}

export function getDreamStartupMarkerPath(workspaceRoot = getWorkspaceDir()): string {
  return resolve(getDreamMemoryDir(workspaceRoot), STARTUP_MARKER_FILE);
}

function readDreamStartupMarker(workspaceRoot = getWorkspaceDir()): { marker: DreamStartupMarker | null; error: string | null } {
  const markerPath = getDreamStartupMarkerPath(workspaceRoot);
  if (!existsSync(markerPath)) return { marker: null, error: null };
  try {
    const content = readFileSync(markerPath, "utf8");
    const initialized = /^initialized:\s*true\s*$/m.test(content);
    const recovery = content.match(/^recovery:\s*(complete|backfill_required)\s*$/m)?.[1] as DreamStartupRecoveryStatus | undefined;
    if (!initialized || !recovery) {
      return { marker: null, error: `Invalid Dream startup marker: ${markerPath}` };
    }
    return { marker: { initialized: true, recovery }, error: null };
  } catch (error) {
    return { marker: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function markerContent(recovery: DreamStartupRecoveryStatus): string {
  return `version: 1\ninitialized: true\nrecovery: ${recovery}\n`;
}

export function writeDreamStartupMarker(
  recovery: DreamStartupRecoveryStatus,
  workspaceRoot = getWorkspaceDir(),
): boolean {
  const markerPath = getDreamStartupMarkerPath(workspaceRoot);
  const content = markerContent(recovery);
  if (existsSync(markerPath) && readFileSync(markerPath, "utf8") === content) return false;
  mkdirSync(getDreamMemoryDir(workspaceRoot), { recursive: true });
  writeFileSync(markerPath, content, "utf8");
  return true;
}

function hasDailyNoteEvidence(workspaceRoot: string): { value: boolean; error: string | null } {
  const dailyDir = getDreamDailyDir(workspaceRoot);
  if (!existsSync(dailyDir)) return { value: false, error: null };
  try {
    return {
      value: readdirSync(dailyDir).some((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file)),
      error: null,
    };
  } catch (error) {
    return { value: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function hasNonDreamMessageEvidence(database?: Database): { value: boolean | null; error: string | null } {
  try {
    const connection = database || getDb();
    const row = connection.query("SELECT 1 AS found FROM messages WHERE chat_jid NOT LIKE 'dream:%' LIMIT 1").get() as
      | { found: number }
      | undefined;
    return { value: row?.found === 1, error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function classifyDreamWorkspaceState(options: {
  workspaceRoot?: string;
  database?: Database;
} = {}): DreamWorkspaceState {
  const workspaceRoot = options.workspaceRoot || getWorkspaceDir();
  const missingDerivedFiles = getDreamDerivedMemoryFiles(workspaceRoot).filter((file) => !existsSync(file));
  const daily = hasDailyNoteEvidence(workspaceRoot);
  const messages = hasNonDreamMessageEvidence(options.database);
  const marker = readDreamStartupMarker(workspaceRoot);
  const evidenceError = [daily.error, messages.error, marker.error].filter(Boolean).join("; ") || null;
  const initialized = marker.marker?.initialized === true;
  const backfillRequired = marker.marker?.recovery === "backfill_required";

  if (missingDerivedFiles.length === 0) {
    return {
      kind: "established_complete",
      missingDerivedFiles,
      hasNonDreamMessages: messages.value,
      hasDailyNotes: daily.value,
      initialized,
      backfillRequired,
      evidenceError,
    };
  }

  const established = messages.value === true || daily.value || initialized || evidenceError !== null;
  return {
    kind: established ? "established_missing_derived" : "fresh",
    missingDerivedFiles,
    hasNonDreamMessages: messages.value,
    hasDailyNotes: daily.value,
    initialized,
    backfillRequired,
    evidenceError,
  };
}

function hasBacklog(backlog: ReturnType<typeof inspectDailyNoteSummaryBacklog>): boolean {
  return backlog.unsummarised > 0
    || backlog.partial > 0
    || backlog.missing_watermark > 0
    || backlog.missing > 0;
}

export function recoverEstablishedDreamWorkspace(
  state: DreamWorkspaceState,
  options: { recentDays?: number } = {},
): DreamStartupRecoveryResult {
  if (state.kind !== "established_missing_derived") {
    throw new Error(`Dream recovery requires established_missing_derived state, received ${state.kind}.`);
  }
  const workspaceRoot = getWorkspaceDir();
  const recentDays = Math.max(1, Math.floor(options.recentDays || AUTO_DREAM_DEFAULT_DAYS));
  const refresh = refreshAgentMemoryFromDailyNotes({ recentDays, writeTypedMemories: false });
  const backlog = inspectDailyNoteSummaryBacklog({ recentDays });
  const incompleteDailyNotes = refresh.currentState.partial_days.length > 0
    || refresh.currentState.unsummarised_days.length > 0;
  const backfillRequired = state.backfillRequired
    || state.evidenceError !== null
    || (state.hasNonDreamMessages === true && !state.hasDailyNotes)
    || incompleteDailyNotes
    || hasBacklog(backlog);
  const markerChanged = writeDreamStartupMarker(backfillRequired ? "backfill_required" : "complete", workspaceRoot);
  return {
    refresh,
    materializedFiles: getDreamDerivedMemoryFiles(workspaceRoot),
    backfillRequired,
    markerChanged,
  };
}

export function dreamStartupBackfillRequired(workspaceRoot = getWorkspaceDir()): boolean {
  const marker = readDreamStartupMarker(workspaceRoot);
  return marker.error !== null || marker.marker?.recovery === "backfill_required";
}

export function recordDreamConsolidationResult(options: {
  successful: boolean;
  outstandingBacklog: boolean;
  workspaceRoot?: string;
}): boolean {
  if (!options.successful || options.outstandingBacklog) return false;
  return writeDreamStartupMarker("complete", options.workspaceRoot || getWorkspaceDir());
}
