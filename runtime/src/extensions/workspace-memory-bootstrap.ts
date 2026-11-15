import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { getWorkspaceDir } from "../core/config-context.js";
import { readAccessConfig } from "../core/config-access.js";
import { getExecutionIdentity, formatExecutionIdentity } from "../core/execution-context.js";
import { getChatJid } from "../core/chat-context.js";
import { ChatAccessDenied } from '../db/session-ownership.js';

const MAX_CONTEXT_CHARS = 12000;

function readOptional(path: string, validate: () => void): string | null {
  validate();
  if (!existsSync(path)) return null;
  let text: string | null;
  try {
    validate();
    text = readFileSync(path, "utf8").trim() || null;
  } catch {
    text = null;
  }
  // A read error must not turn revoked authority into an optional-file fallback.
  validate();
  return text;
}

function truncate(text: string, maxChars = MAX_CONTEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function buildWorkspaceMemoryBootstrap(workspace: string, validate: () => void): string {
  const AGENT_MEMORY_PATH = resolve(workspace, "notes/memory/MEMORY.md");
  const NOTES_INDEX_PATH = resolve(workspace, "notes/index.md");
  const AGENT_PREFS_PATH = resolve(workspace, "notes/preferences/agent.md");
  const memory = readOptional(AGENT_MEMORY_PATH, validate);
  const notesIndex = readOptional(NOTES_INDEX_PATH, validate);
  const agentPrefs = readOptional(AGENT_PREFS_PATH, validate);

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
    const identity = getExecutionIdentity(), workspace = getWorkspaceDir();
    let denied = false;
    const validate = () => {
      try {
        if (denied || readAccessConfig().mode !== 'single-user' || getWorkspaceDir() !== workspace || getExecutionIdentity() !== identity) throw new ChatAccessDenied();
        if (identity && (identity.mode !== 'single-user' || identity.provenance.ownerUserId !== 'default'
          || identity.provenance.actorUserId !== 'default' || identity.rootChatJid !== 'web:default'
          || identity.provenance.chatJid !== getChatJid(''))) throw new ChatAccessDenied();
      } catch { denied = true; throw new ChatAccessDenied(); }
    };
    validate();
    const memory = buildWorkspaceMemoryBootstrap(workspace, validate);
    const prompt = event.systemPrompt + '\n\n' + (identity ? formatExecutionIdentity(identity) + '\n\n' : '') + memory;
    validate();
    return { systemPrompt: prompt };
  });
};
