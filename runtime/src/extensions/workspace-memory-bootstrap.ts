import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { WORKSPACE_DIR } from "../core/config.js";
import { getExecutionIdentity, formatExecutionIdentity } from "../core/execution-context.js";
import { getChatJid } from "../core/chat-context.js";
import { formatAccountResponseGuidance } from '../core/account-preferences.js';

const AGENT_MEMORY_PATH = resolve(WORKSPACE_DIR, "notes/memory/MEMORY.md");
const NOTES_INDEX_PATH = resolve(WORKSPACE_DIR, "notes/index.md");
const AGENT_PREFS_PATH = resolve(WORKSPACE_DIR, "notes/preferences/agent.md");
const MAX_CONTEXT_CHARS = 12000;

function readOptional(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

function truncate(text: string, maxChars = MAX_CONTEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function buildWorkspaceMemoryBootstrap(): string {
  const memory = readOptional(AGENT_MEMORY_PATH);
  const notesIndex = readOptional(NOTES_INDEX_PATH);
  const agentPrefs = readOptional(AGENT_PREFS_PATH);

  const lines: string[] = [
    "## Workspace memory bootstrap",
    "Align startup context with the workspace note process described in AGENTS.md.",
    "Load this memory at session start and treat these files as the canonical compact memory/index layer before exploring deeper notes:",
  ];

  if (memory) {
    lines.push(`### ${AGENT_MEMORY_PATH}`, truncate(memory));
  } else {
    lines.push(`### ${AGENT_MEMORY_PATH}`, "(missing)");
  }

  if (notesIndex) {
    lines.push(`### ${NOTES_INDEX_PATH}`, truncate(notesIndex, 8000));
  } else {
    lines.push(`### ${NOTES_INDEX_PATH}`, "(missing)");
  }

  if (agentPrefs) {
    lines.push(`### ${AGENT_PREFS_PATH}`, truncate(agentPrefs, 4000));
  }

  lines.push(
    "Use MEMORY.md as the durable startup index, notes/index.md as the map of structured notes, open linked day/topic files only when you need more detail, and use search_workspace for note lookups.",
    "When doing Dream-style maintenance, prefer rough searches from known suspicions over exhaustive transcript reading.",
    "Keep this aligned with the workspace note hierarchy rather than inventing a parallel memory source.",
  );

  return lines.join("\n\n");
}

export const workspaceMemoryBootstrap: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => {
    const identity = getExecutionIdentity();
    if (!identity) return { systemPrompt: `${event.systemPrompt}\n\n${buildWorkspaceMemoryBootstrap()}` };
    if (identity.provenance.chatJid !== getChatJid()) throw new Error("Execution identity does not match the active chat.");
    const owner = identity.provenance.ownerUserId;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new Error("Invalid memory owner ID.");
    const paths = [
      resolve(WORKSPACE_DIR, "notes/users", owner, "MEMORY.md"),
      resolve(WORKSPACE_DIR, "notes/users", owner, "preferences.md"),
      resolve(WORKSPACE_DIR, "notes/family/MEMORY.md"),
    ];
    const memory = paths.map(path => `### ${path}\n${truncate(readOptional(path) ?? "(missing)", 8000)}`).join("\n\n");
    const preferences = identity.preferences ? formatAccountResponseGuidance(identity.preferences) : '';
    return { systemPrompt: `${event.systemPrompt}\n\n${formatExecutionIdentity(identity)}\n\n## User and shared family memory\n\n${memory}${preferences ? `\n\n${preferences}` : ''}` };
  });
};
