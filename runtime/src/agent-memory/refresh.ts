import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";

import { WORKSPACE_DIR } from "../core/config.js";
import { getDb } from "../db.js";

export const DAILY_NOTES_DIR = resolve(WORKSPACE_DIR, "notes/daily");
export const AGENT_MEMORY_DIR = resolve(WORKSPACE_DIR, "notes/memory");
export const AGENT_MEMORY_USER_PATH = resolve(AGENT_MEMORY_DIR, "user.md");
export const AGENT_MEMORY_FEEDBACK_PATH = resolve(AGENT_MEMORY_DIR, "feedback.md");
export const AGENT_MEMORY_PROJECT_PATH = resolve(AGENT_MEMORY_DIR, "project.md");
export const AGENT_MEMORY_REFERENCE_PATH = resolve(AGENT_MEMORY_DIR, "reference.md");
const SUMMARY_MARKER = "<!-- NEEDS_SUMMARY -->";
const SUMMARY_UPDATE_MARKER = "<!-- NEEDS_SUMMARY_UPDATE -->";
const INCOMPLETE_WARNING_TITLE = "> ⚠ **Incomplete daily note**";
const MEMORY_LINE_LIMIT = 200;
const MEMORY_MAX_BYTES = 25 * 1024;
const MAX_SIGNAL_ITEMS = 6;
const ACK_MESSAGES = new Set(["yes", "ok", "okay", "go", "done", "well?", "so?", "hey", "hello", "hi"]);
const MEMORY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for", "from", "had", "has", "have",
  "i", "if", "in", "into", "is", "it", "its", "my", "of", "on", "or", "our", "that", "the", "their", "them",
  "then", "there", "these", "this", "to", "was", "we", "were", "with", "you", "your",
  "today", "yesterday", "tomorrow", "morning", "afternoon", "evening", "week", "month",
  "prefer", "preferred", "use", "using", "used", "now", "instead",
]);

export interface DailyAgentSidecar {
  schema_version: 1;
  generated_at: string;
  source_note: string;
  date: string;
  summarised_until: string | null;
  messages_total: number | null;
  messages_user: number | null;
  messages_assistant: number | null;
  session_trees: number | null;
  session_chats: number | null;
  first_message: string | null;
  last_message: string | null;
  scope_mode: string | null;
  scope_anchor: string | null;
  state: "complete" | "partial" | "unsummarised" | "missing_watermark";
  summary: string | null;
  summary_updates: string[];
  needs_summary_update: boolean;
}

export interface AgentMemoryTranscriptSignals {
  user_directives: string[];
  assistant_outcomes: string[];
}

export interface AgentMemoryCurrentStateDay {
  date: string;
  summarised_until: string | null;
  summary: string | null;
  summary_updates: string[];
  messages_total: number | null;
  session_trees: number | null;
  session_chats: number | null;
  source_note: string;
  transcript_signals: AgentMemoryTranscriptSignals;
}

export interface AgentMemoryCurrentStatePartialDay {
  date: string;
  state: "partial" | "missing_watermark";
  summarised_until: string | null;
  last_message: string | null;
  source_note: string;
  needs_summary_update: boolean;
}

export interface AgentMemoryCurrentStateUnsummarisedDay {
  date: string;
  last_message: string | null;
  source_note: string;
}

export interface AgentMemoryCurrentState {
  schema_version: 1;
  generated_at: string;
  source_dir: string;
  recent_days: number;
  latest_complete_date: string | null;
  latest_complete_summary: string | null;
  complete_days: AgentMemoryCurrentStateDay[];
  partial_days: AgentMemoryCurrentStatePartialDay[];
  unsummarised_days: AgentMemoryCurrentStateUnsummarisedDay[];
}

interface FrontMatter {
  fields: Record<string, string>;
  body: string;
}

export interface RefreshAgentMemoryResult {
  sidecars: DailyAgentSidecar[];
  currentState: AgentMemoryCurrentState;
  currentStatePath: string;
  recentContextPath: string;
  memoryPath: string;
}

function splitFrontMatter(content: string): FrontMatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { fields: {}, body: content };
  const fmText = match[1];
  const body = content.slice(match[0].length);
  const fields: Record<string, string> = {};
  for (const line of fmText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    fields[key] = value;
  }
  return { fields, body };
}

function extractSummary(body: string): string | null {
  const match = body.match(/## Summary\s*\n+([\s\S]*?)(?=^##\s|\s*$)/m);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw || raw === SUMMARY_MARKER) return null;
  if (raw.startsWith(SUMMARY_MARKER)) {
    const cleaned = raw.replace(SUMMARY_MARKER, "").trim();
    return cleaned.length ? cleaned : null;
  }
  return raw;
}

function extractSummaryUpdates(body: string): string[] {
  const updates: string[] = [];
  const re = /## Summary update.*?\n+([\s\S]*?)(?=^##\s|\s*$)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const raw = match[1].trim();
    if (!raw || raw.includes(SUMMARY_UPDATE_MARKER)) continue;
    updates.push(raw);
  }
  return updates;
}

function parseIntOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractDateFromPath(value: string): string {
  const match = value.match(/(\d{4}-\d{2}-\d{2})\.md$/);
  return match ? match[1] : value.slice(0, 10);
}

function sortByDateAsc<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date));
}

function sortByDateDesc<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date));
}

function compactText(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact || null;
}

function _readOptionalText(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return compactText(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readOptionalMarkdown(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text.length ? text : null;
  } catch {
    return null;
  }
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function absolutizeRelativeDates(value: string, anchorDate: string): string {
  return value
    .replace(/\btoday\b/gi, anchorDate)
    .replace(/\byesterday\b/gi, shiftIsoDate(anchorDate, -1))
    .replace(/\btomorrow\b/gi, shiftIsoDate(anchorDate, 1))
    .replace(/\bthis morning\b/gi, `morning of ${anchorDate}`)
    .replace(/\bthis afternoon\b/gi, `afternoon of ${anchorDate}`)
    .replace(/\bthis evening\b/gi, `evening of ${anchorDate}`)
    .replace(/\blast week\b/gi, `week of ${shiftIsoDate(anchorDate, -7)}`)
    .replace(/\bthis week\b/gi, `week of ${anchorDate}`);
}

function normalizeMemoryText(value: string, anchorDate: string): string | null {
  const compact = compactText(value);
  if (!compact) return null;
  return absolutizeRelativeDates(compact, anchorDate);
}

function tokenizeMemorySignature(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !/^\d{4}$/.test(token))
    .filter((token) => !/^\d{4}\d{2}\d{2}$/.test(token))
    .filter((token) => !MEMORY_STOP_WORDS.has(token));
}

function buildMemorySignature(value: string): string {
  return tokenizeMemorySignature(value).slice(0, 6).join(" ");
}

function sharesMemoryTopic(a: string, b: string): boolean {
  const left = new Set(tokenizeMemorySignature(a));
  const right = new Set(tokenizeMemorySignature(b));
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
    if (overlap >= 2) return true;
  }
  return false;
}

function hasRevisionCue(value: string): boolean {
  return /\b(now|instead|switched|migrated|moved|replace(?:d)?|use|prefer|no longer|deprecated|removed|drop(?:ped)?)\b/i.test(value);
}

function hasNegation(value: string): boolean {
  return /\b(no|not|never|avoid|don['’]t|do not|stop|without|deprecated|removed|no longer)\b/i.test(value);
}

interface MemoryCandidate {
  text: string;
  date: string;
}

function _curateMemoryCandidates(candidates: MemoryCandidate[], limit = 24): string[] {
  const curated: Array<{ text: string; signature: string }> = [];

  for (const candidate of candidates) {
    const normalized = normalizeMemoryText(candidate.text, candidate.date);
    if (!normalized) continue;
    const signature = buildMemorySignature(normalized) || normalized.toLowerCase();

    const isDuplicateOrSuperseded = curated.some((existing) => {
      if (existing.text === normalized) return true;
      if (existing.signature === signature) return true;
      if (!sharesMemoryTopic(existing.text, normalized)) return false;
      if (existing.text.includes(normalized) || normalized.includes(existing.text)) return true;
      if (hasRevisionCue(existing.text) || hasRevisionCue(normalized)) return true;
      return hasNegation(existing.text) !== hasNegation(normalized);
    });

    if (isDuplicateOrSuperseded) continue;
    curated.push({ text: normalized, signature });
    if (curated.length >= limit) break;
  }

  return curated.map((entry) => entry.text);
}

function truncateText(value: string | null | undefined, maxChars = 220): string | null {
  const compact = compactText(value);
  if (!compact) return null;
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1)}…`;
}

function isAckMessage(value: string): boolean {
  return ACK_MESSAGES.has(value.trim().toLowerCase());
}

function buildRoughSearchTerms(sidecar: DailyAgentSidecar): string[] {
  const seed = [sidecar.summary || "", ...sidecar.summary_updates].join(" ");
  const terms = tokenizeMemorySignature(seed).filter((token) => token.length >= 4);
  return [...new Set(terms)];
}

interface TranscriptRow {
  content: string;
  is_bot_message: number;
  is_terminal_agent_reply: number;
  is_steering_message: number;
  chat_jid: string;
  root_chat_jid: string;
}

function buildScopeFilter(sidecar: DailyAgentSidecar): { clause: string; params: string[] } {
  const anchor = sidecar.scope_anchor || "web:default";
  if (sidecar.scope_mode === "all-chats" || anchor === "*") {
    return {
      clause: "m.chat_jid NOT LIKE 'dream:%'",
      params: [],
    };
  }
  if (sidecar.scope_mode === "all-web-session-trees" || anchor.startsWith("web:")) {
    return {
      clause: "m.chat_jid LIKE 'web:%'",
      params: [],
    };
  }
  return {
    clause: "m.chat_jid = ?",
    params: [anchor],
  };
}

function buildChatLabel(sidecar: DailyAgentSidecar, row: TranscriptRow): string {
  if (row.chat_jid === (sidecar.scope_anchor || "")) return "";
  return `[${row.chat_jid}] `;
}

function collectTranscriptSignals(sidecar: DailyAgentSidecar): AgentMemoryTranscriptSignals {
  const { clause, params } = buildScopeFilter(sidecar);
  const roughTerms = buildRoughSearchTerms(sidecar);
  try {
    const db = getDb();
    const transcriptFilter = roughTerms.length > 0
      ? ` AND (${roughTerms.map(() => "m.content LIKE ? COLLATE NOCASE").join(" OR ")})`
      : "";
    const rows = db.query<TranscriptRow, any[]>(
      `SELECT m.content,
              m.is_bot_message,
              COALESCE(m.is_terminal_agent_reply, 0) AS is_terminal_agent_reply,
              COALESCE(m.is_steering_message, 0) AS is_steering_message,
              m.chat_jid,
              COALESCE(cb.root_chat_jid, m.chat_jid) AS root_chat_jid
       FROM messages m
       LEFT JOIN chat_branches cb ON cb.chat_jid = m.chat_jid
       WHERE substr(m.timestamp, 1, 10) = ?
         AND ${clause}
         AND COALESCE(m.is_steering_message, 0) = 0${transcriptFilter}
       ORDER BY m.timestamp ASC`
    ).all(sidecar.date, ...params, ...roughTerms.map((term) => `%${term}%`));

    const user_directives: string[] = [];
    const assistant_outcomes: string[] = [];
    const seenUser = new Set<string>();
    const seenAssistant = new Set<string>();

    for (const row of rows) {
      const snippet = truncateText(row.content);
      if (!snippet) continue;
      const labelled = `${buildChatLabel(sidecar, row)}${snippet}`;

      if (!row.is_bot_message) {
        if (snippet.startsWith("/")) continue;
        if (isAckMessage(snippet)) continue;
        if (!seenUser.has(labelled)) {
          user_directives.push(labelled);
          seenUser.add(labelled);
        }
      } else if (row.is_terminal_agent_reply || roughTerms.length > 0) {
        if (!seenAssistant.has(labelled)) {
          assistant_outcomes.push(labelled);
          seenAssistant.add(labelled);
        }
      }

      if (user_directives.length >= MAX_SIGNAL_ITEMS && assistant_outcomes.length >= MAX_SIGNAL_ITEMS) break;
    }

    return { user_directives: user_directives.slice(0, MAX_SIGNAL_ITEMS), assistant_outcomes: assistant_outcomes.slice(0, MAX_SIGNAL_ITEMS) };
  } catch {
    return { user_directives: [], assistant_outcomes: [] };
  }
}

function buildSidecar(notePath: string, content: string): DailyAgentSidecar {
  const { fields, body } = splitFrontMatter(content);
  const summary = extractSummary(body);
  const summaryUpdates = extractSummaryUpdates(body);
  const needsSummaryUpdate = body.includes(SUMMARY_UPDATE_MARKER);
  const hasIncompleteWarning = body.includes(INCOMPLETE_WARNING_TITLE);
  const summarisedUntil = fields.summarised_until || null;

  let state: DailyAgentSidecar["state"] = "complete";
  if (!summary) state = "unsummarised";
  else if (!summarisedUntil) state = "missing_watermark";
  else if (needsSummaryUpdate || hasIncompleteWarning) state = "partial";

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_note: notePath,
    date: fields.date || extractDateFromPath(notePath),
    summarised_until: summarisedUntil,
    messages_total: parseIntOrNull(fields.messages_total),
    messages_user: parseIntOrNull(fields.messages_user),
    messages_assistant: parseIntOrNull(fields.messages_assistant),
    session_trees: parseIntOrNull(fields.session_trees),
    session_chats: parseIntOrNull(fields.session_chats),
    first_message: fields.first_message || null,
    last_message: fields.last_message || null,
    scope_mode: fields.scope_mode || null,
    scope_anchor: fields.scope_anchor || null,
    state,
    summary,
    summary_updates: summaryUpdates,
    needs_summary_update: needsSummaryUpdate,
  };
}

function formatCompactDay(sidecar: DailyAgentSidecar): string[] {
  const lines: string[] = [];
  lines.push(`### ${sidecar.date}`);
  lines.push("");
  lines.push(`- State: ${sidecar.state}`);
  if (sidecar.summarised_until) lines.push(`- Summarised until: ${sidecar.summarised_until}`);
  if (sidecar.messages_total !== null) lines.push(`- Messages: ${sidecar.messages_total}`);
  if (sidecar.session_trees !== null) lines.push(`- Session trees: ${sidecar.session_trees}`);
  if (sidecar.session_chats !== null) lines.push(`- Session chats: ${sidecar.session_chats}`);
  if (sidecar.summary) {
    lines.push("");
    lines.push("#### Summary");
    lines.push("");
    lines.push(`- ${sidecar.summary.replace(/\s+/g, " ").trim()}`);
  }
  if (sidecar.summary_updates.length > 0) {
    lines.push("");
    lines.push("#### Updates");
    lines.push("");
    for (const update of sidecar.summary_updates) {
      lines.push(`- ${update.replace(/\s+/g, " ").trim()}`);
    }
  }
  lines.push("");
  return lines;
}

function uniqueSnippets(values: Iterable<string>, limit = 24): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const compact = truncateText(value, 220);
    if (!compact || seen.has(compact)) continue;
    seen.add(compact);
    output.push(compact);
    if (output.length >= limit) break;
  }
  return output;
}

function buildUserMemoryMarkdown(currentState: AgentMemoryCurrentState): string {
  const lines = ["# User memory", ""];
  const prefs = readOptionalMarkdown(resolve(WORKSPACE_DIR, "notes/preferences/agent.md"));
  if (prefs) {
    lines.push("## Role and preferences", "", prefs, "");
  }
  const inferred = uniqueSnippets(currentState.complete_days.flatMap((day) => day.transcript_signals.user_directives.filter((entry) => /prefer|always|never|use /i.test(entry))));
  if (inferred.length > 0) {
    lines.push("## Inferred working preferences", "");
    for (const item of inferred) lines.push(`- ${item}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildFeedbackMemoryMarkdown(currentState: AgentMemoryCurrentState): string {
  const lines = ["# Feedback memory", "", "## Corrections and steering cues", ""];
  const feedback = uniqueSnippets(currentState.complete_days.flatMap((day) => day.transcript_signals.user_directives));
  if (feedback.length === 0) {
    lines.push("- No durable feedback cues captured yet.", "");
  } else {
    for (const item of feedback) lines.push(`- ${item}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildProjectMemoryMarkdown(currentState: AgentMemoryCurrentState): string {
  const lines = ["# Project memory", "", "## Ongoing work and recent outcomes", ""];
  for (const day of currentState.complete_days.slice(0, Math.max(4, currentState.recent_days))) {
    const summary = truncateText(day.summary, 260) || "(no summary)";
    lines.push(`### ${day.date}`, "", `- ${summary}`);
    for (const outcome of day.transcript_signals.assistant_outcomes.slice(0, 3)) {
      lines.push(`- Outcome: ${outcome}`);
    }
    lines.push("");
  }
  if (currentState.partial_days.length > 0 || currentState.unsummarised_days.length > 0) {
    lines.push("## Pending consolidation", "");
    for (const day of currentState.partial_days) lines.push(`- Partial: ${day.date}`);
    for (const day of currentState.unsummarised_days) lines.push(`- Unsummarised: ${day.date}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildReferenceMemoryMarkdown(): string {
  const lines = ["# Reference memory", ""];
  const notesIndex = readOptionalMarkdown(resolve(WORKSPACE_DIR, "notes/index.md"));
  if (notesIndex) {
    lines.push("## Notes index", "", notesIndex, "");
  } else {
    lines.push("- notes/index.md is missing.", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildCurrentStateMarkdown(currentState: AgentMemoryCurrentState): string {
  const lines: string[] = [];
  lines.push("# Current Dream state", "");
  lines.push(`Generated: ${currentState.generated_at}`, "");
  lines.push("## Status", "");
  lines.push(`- Window: last ${currentState.recent_days} days`);
  lines.push(`- Complete days: ${currentState.complete_days.length}`);
  lines.push(`- Partial days: ${currentState.partial_days.length}`);
  lines.push(`- Unsummarised days: ${currentState.unsummarised_days.length}`);
  if (currentState.latest_complete_date) lines.push(`- Latest complete day: ${currentState.latest_complete_date}`);
  lines.push("");
  if (currentState.complete_days.length > 0) {
    lines.push("## Complete days", "");
    for (const day of currentState.complete_days) {
      const summary = truncateText(day.summary, 160) || "(no summary)";
      lines.push(`- ${day.date}`);
      lines.push(`  - Summary: ${summary}`);
      if (day.summarised_until) lines.push(`  - Summarised until: ${day.summarised_until}`);
      if (day.messages_total !== null) lines.push(`  - Messages: ${day.messages_total}`);
      if (day.session_trees !== null) lines.push(`  - Session trees: ${day.session_trees}`);
      if (day.session_chats !== null) lines.push(`  - Session chats: ${day.session_chats}`);
    }
    lines.push("");
  }
  if (currentState.partial_days.length > 0) {
    lines.push("## Partial days", "");
    for (const day of currentState.partial_days) {
      lines.push(`- ${day.date} — ${day.state}${day.summarised_until ? ` — summarised_until ${day.summarised_until}` : ""}`);
    }
    lines.push("");
  }
  if (currentState.unsummarised_days.length > 0) {
    lines.push("## Unsummarised days", "");
    for (const day of currentState.unsummarised_days) {
      lines.push(`- ${day.date}`);
    }
    lines.push("");
  }
  lines.push("## Source", "");
  lines.push(`- Daily notes directory: ${DAILY_NOTES_DIR}`);
  return `${lines.join("\n").trimEnd()}\n`;
}

function resolveMemoryIndexDayLink(date: string): string {
  const sparseDayPath = resolve(AGENT_MEMORY_DIR, "days", `${date}.md`);
  return existsSync(sparseDayPath) ? `days/${date}.md` : `../daily/${date}.md`;
}

function buildMemoryMarkdown(currentState: AgentMemoryCurrentState): string {
  const lines: string[] = [];
  lines.push("# MEMORY.md", "");
  lines.push("Dream-maintained memory index generated from the message database plus human-readable daily notes.", "");
  lines.push(`Generated: ${currentState.generated_at}`, "");
  lines.push("## Status", "");
  lines.push(`- Window: last ${currentState.recent_days} days`);
  lines.push(`- Complete days: ${currentState.complete_days.length}`);
  lines.push(`- Partial days: ${currentState.partial_days.length}`);
  lines.push(`- Unsummarised days: ${currentState.unsummarised_days.length}`);
  if (currentState.latest_complete_date) {
    lines.push(`- Latest complete day: ${currentState.latest_complete_date}`);
  }
  lines.push("");

  lines.push("## Memory types", "");
  lines.push(`- [User memory](user.md) — role and preferences the agent should keep stable`);
  lines.push(`- [Feedback memory](feedback.md) — corrections, steering cues, and remembered constraints`);
  lines.push(`- [Project memory](project.md) — ongoing work, recent outcomes, and pending follow-up`);
  lines.push(`- [Reference memory](reference.md) — note index and durable external pointers`);
  lines.push("");

  if (currentState.partial_days.length > 0 || currentState.unsummarised_days.length > 0) {
    lines.push("## Attention needed", "");
    for (const day of currentState.partial_days) lines.push(`- ${day.date} — ${day.state}`);
    for (const day of currentState.unsummarised_days) lines.push(`- ${day.date} — unsummarised`);
    lines.push("");
  }

  lines.push("## Recent daily memories", "");
  if (currentState.complete_days.length === 0) {
    lines.push("- No complete daily-note memories yet.", "");
  } else {
    for (const day of currentState.complete_days.slice(0, currentState.recent_days)) {
      const hook = compactText(day.summary) || "(no summary)";
      const truncatedHook = hook.length > 110 ? `${hook.slice(0, 109)}…` : hook;
      lines.push(`- [${day.date}](${resolveMemoryIndexDayLink(day.date)})`);
      lines.push(`  - ${truncatedHook}`);
    }
    lines.push("");
  }

  lines.push("## Sources", "");
  lines.push(`- [current-state.md](current-state.md)`);
  lines.push(`- [recent-context.md](recent-context.md)`);
  lines.push(`- Daily notes directory: ${DAILY_NOTES_DIR}`);
  lines.push(`- Sparse day-memory directory (model-owned, optional): ${resolve(AGENT_MEMORY_DIR, "days")}`);

  while (lines.length > MEMORY_LINE_LIMIT || Buffer.byteLength(`${lines.join("\n").trimEnd()}\n`, "utf8") > MEMORY_MAX_BYTES) {
    const dailyHeaderIndex = lines.indexOf("## Recent daily memories");
    if (dailyHeaderIndex === -1) break;
    const firstEntryIndex = lines.findIndex((line, index) => index > dailyHeaderIndex && line.startsWith("- ["));
    if (firstEntryIndex === -1) break;
    lines.splice(firstEntryIndex, 1);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function buildEmptyCurrentState(recentDays: number): AgentMemoryCurrentState {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_dir: DAILY_NOTES_DIR,
    recent_days: recentDays,
    latest_complete_date: null,
    latest_complete_summary: null,
    complete_days: [],
    partial_days: [],
    unsummarised_days: [],
  };
}

export function refreshAgentMemoryFromDailyNotes(options?: {
  recentDays?: number;
  writeTypedMemories?: boolean;
}): RefreshAgentMemoryResult {
  const recentDays = Math.max(1, options?.recentDays ?? 7);
  const writeTypedMemories = options?.writeTypedMemories !== false;
  mkdirSync(AGENT_MEMORY_DIR, { recursive: true });

  const currentStatePath = `${AGENT_MEMORY_DIR}/current-state.md`;
  const recentContextPath = `${AGENT_MEMORY_DIR}/recent-context.md`;
  const memoryPath = `${AGENT_MEMORY_DIR}/MEMORY.md`;

  if (!existsSync(DAILY_NOTES_DIR)) {
    const currentState = buildEmptyCurrentState(recentDays);
    writeFileSync(currentStatePath, buildCurrentStateMarkdown(currentState), "utf8");
    writeFileSync(recentContextPath, "# Agent-ready recent context\n\nNo daily notes found yet.\n", "utf8");
    writeFileSync(memoryPath, buildMemoryMarkdown(currentState), "utf8");
    return { sidecars: [], currentState, currentStatePath, recentContextPath, memoryPath };
  }

  const notePaths = readdirSync(DAILY_NOTES_DIR)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    .sort()
    .map((file) => `${DAILY_NOTES_DIR}/${file}`);

  const sidecars = notePaths.map((path) => buildSidecar(path, readFileSync(path, "utf8")));

  for (const notePath of notePaths) {
    rmSync(notePath.replace(/\.md$/i, ".agent.json"), { force: true });
  }

  const cutoff = new Date(Date.now() - recentDays * 86400000).toISOString().slice(0, 10);
  const recent = sortByDateDesc(sidecars.filter((sidecar) => sidecar.date >= cutoff));
  const complete = recent.filter((sidecar) => sidecar.state === "complete");
  const partial = recent.filter((sidecar) => sidecar.state === "partial" || sidecar.state === "missing_watermark");
  const unsummarised = recent.filter((sidecar) => sidecar.state === "unsummarised");

  const currentState: AgentMemoryCurrentState = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_dir: DAILY_NOTES_DIR,
    recent_days: recentDays,
    latest_complete_date: complete[0]?.date || null,
    latest_complete_summary: complete[0]?.summary || null,
    complete_days: complete.map((sidecar) => ({
      date: sidecar.date,
      summarised_until: sidecar.summarised_until,
      summary: sidecar.summary,
      summary_updates: sidecar.summary_updates,
      messages_total: sidecar.messages_total,
      session_trees: sidecar.session_trees,
      session_chats: sidecar.session_chats,
      source_note: sidecar.source_note,
      transcript_signals: collectTranscriptSignals(sidecar),
    })),
    partial_days: partial.map((sidecar) => ({
      date: sidecar.date,
      state: (sidecar.state === "missing_watermark" ? "missing_watermark" : "partial") as AgentMemoryCurrentStatePartialDay["state"],
      summarised_until: sidecar.summarised_until,
      last_message: sidecar.last_message,
      source_note: sidecar.source_note,
      needs_summary_update: sidecar.needs_summary_update,
    })),
    unsummarised_days: unsummarised.map((sidecar) => ({
      date: sidecar.date,
      last_message: sidecar.last_message,
      source_note: sidecar.source_note,
    })),
  };

  writeFileSync(currentStatePath, buildCurrentStateMarkdown(currentState), "utf8");

  const summaryLines: string[] = [];
  summaryLines.push("# Agent-ready recent context", "");
  summaryLines.push(`Generated: ${currentState.generated_at}`, "");
  summaryLines.push(`Source: \`${DAILY_NOTES_DIR}\``, "");
  summaryLines.push("## Status", "");
  summaryLines.push(`- Window: last ${recentDays} days`);
  summaryLines.push(`- Complete days: ${complete.length}`);
  summaryLines.push(`- Partial days: ${partial.length}`);
  summaryLines.push(`- Unsummarised days: ${unsummarised.length}`);
  if (currentState.latest_complete_date) {
    summaryLines.push(`- Latest complete day: ${currentState.latest_complete_date}`);
  }
  summaryLines.push("");

  if (partial.length > 0) {
    summaryLines.push("## Partial days", "");
    for (const sidecar of sortByDateAsc(partial)) {
      summaryLines.push(`- ${sidecar.date} — ${sidecar.state} — \`${sidecar.source_note}\``);
    }
    summaryLines.push("");
  }

  if (unsummarised.length > 0) {
    summaryLines.push("## Unsummarised days", "");
    for (const sidecar of sortByDateAsc(unsummarised)) {
      summaryLines.push(`- ${sidecar.date} — \`${sidecar.source_note}\``);
    }
    summaryLines.push("");
  }

  if (complete.length > 0) {
    summaryLines.push("## Recent complete days", "");
    for (const sidecar of sortByDateAsc(complete)) {
      summaryLines.push(...formatCompactDay(sidecar));
    }
  }

  writeFileSync(recentContextPath, `${summaryLines.join("\n").trimEnd()}\n`, "utf8");
  rmSync(`${AGENT_MEMORY_DIR}/current-state.json`, { force: true });

  // Runtime no longer materializes `notes/memory/days/` from `notes/daily/`.
  // That subtree is model-owned and should remain sparse/optional rather than
  // acting as a mirrored shadow tree of every complete daily note.

  if (writeTypedMemories) {
    writeFileSync(AGENT_MEMORY_USER_PATH, buildUserMemoryMarkdown(currentState), "utf8");
    writeFileSync(AGENT_MEMORY_FEEDBACK_PATH, buildFeedbackMemoryMarkdown(currentState), "utf8");
    writeFileSync(AGENT_MEMORY_PROJECT_PATH, buildProjectMemoryMarkdown(currentState), "utf8");
    writeFileSync(AGENT_MEMORY_REFERENCE_PATH, buildReferenceMemoryMarkdown(), "utf8");
  }
  writeFileSync(memoryPath, buildMemoryMarkdown(currentState), "utf8");

  return { sidecars, currentState, currentStatePath, recentContextPath, memoryPath };
}
