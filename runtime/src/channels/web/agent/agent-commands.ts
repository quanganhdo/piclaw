/**
 * channels/web/agent/agent-commands.ts — GET /agent/commands endpoint.
 *
 * Returns the current session's registered command set as JSON for the
 * compose-box autocomplete. Combines core control commands, extension
 * commands, prompt templates, and skills.
 *
 * Consumers:
 *   - compose-box.ts fetches this on mount to populate autocomplete.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { CONTROL_COMMAND_DEFINITIONS } from "../../../agent-control/command-registry.js";
import type { AgentPool } from "../../../agent-pool.js";
import { appendServerTiming, measureAsync } from "../http/server-timing.js";

export interface CommandEntry {
  name: string;
  description: string;
  source: "core" | "extension" | "pi-extension" | "skill" | "template";
}

/**
 * Build the full command list from a session.
 */
function buildCommandList(session: AgentSession | null): CommandEntry[] {
  const entries: CommandEntry[] = [];
  const seen = new Set<string>();

  const add = (name: string, description: string, source: CommandEntry["source"]) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ name, description, source });
  };

  // Core control commands
  for (const cmd of CONTROL_COMMAND_DEFINITIONS) {
    add(cmd.name, cmd.description, "core");
    for (const alias of cmd.aliases ?? []) {
      add(alias, cmd.description, "core");
    }
  }

  // Extension commands
  if (session?.extensionRunner) {
    const isPiBuiltin = (path: string | undefined) =>
      !!path && path.includes("node_modules/@earendil-works/pi-");
    const extCommands = session.extensionRunner.getRegisteredCommands();
    for (const entry of extCommands) {
      const name = entry.invocationName || entry.name;
      if (!name) continue;
      const entryPath = entry.sourceInfo?.path;
      const description = entry.description || "extension command";
      const source = isPiBuiltin(entryPath) ? "pi-extension" as const : "extension" as const;
      add(`/${name}`, description, source);
    }
  }

  // Prompt templates
  for (const template of session?.promptTemplates ?? []) {
    add(`/${template.name}`, template.description || "prompt template", "template");
  }

  // Skills
  if (session?.resourceLoader) {
    const skills = session.resourceLoader.getSkills().skills;
    for (const skill of skills) {
      add(`/skill:${skill.name}`, skill.description || "skill", "skill");
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Handle GET /agent/commands — return the command registry as JSON.
 */
export async function handleAgentCommandsRequest(
  req: Request,
  options: {
    defaultChatJid: string;
    agentPool: AgentPool;
    json: (payload: unknown, status?: number) => Response;
  },
): Promise<Response> {
  const url = new URL(req.url);
  const chatJid = url.searchParams.get("chat_jid")?.trim() || options.defaultChatJid;

  const { result, durationMs } = await measureAsync(async () => {
    try {
      const native = await options.agentPool.getDurableSessionMetadata?.(chatJid);
      if (native !== undefined) {
        if (!native) return options.json({ error: "No active session for this chat" }, 404);
        const catalogue = native.commandCatalogue;
        if (!Array.isArray(catalogue)) throw new Error("Missing native command catalogue");
        const names = (entries: typeof catalogue) => entries.flatMap(entry => [entry.name, ...(entry.aliases ?? [])]);
        const available = new Set(names(catalogue.filter(entry =>
          ["native", "web input", "web UI"].includes(entry.status))).map(name => name.toLowerCase()));
        return options.json({
          commands: buildCommandList(null).filter(command => available.has(command.name.toLowerCase())),
          backend: "durable",
          unavailable: ["legacy-extension-commands", "prompt-templates", "skills"],
          unavailable_commands: [...new Set(names(catalogue.filter(entry => entry.status === "unavailable")))].sort(),
        }, 200);
      }
    } catch {
      return options.json({ error: "Native command metadata unavailable" }, 503);
    }
    try {
      const session = await options.agentPool.getSessionForIntrospection(chatJid);
      return options.json({ commands: buildCommandList(session) }, 200);
    } catch {
      return options.json({ commands: buildCommandList(null) }, 200);
    }
  });

  return appendServerTiming(result, { name: "agent_commands", durationMs });
}
