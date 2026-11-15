/**
 * agent-control/agent-control-parser.ts – Parse raw text into control commands.
 *
 * Takes a raw message string, strips any trigger prefix (@BotName), and
 * attempts to match it against the registered command parsers. Returns
 * an AgentControlCommand if the text is a valid control command, or null
 * if it's a regular message.
 *
 * Consumers:
 *   - runtime/message-loop.ts calls parseControlCommand() on each inbound
 *     message to determine if it should be handled as a control command.
 *   - channels/web/request-router.ts uses it for web-channel messages.
 */

import type { AgentControlCommand } from "./agent-control-types.js";
import { normalizeControlCommandName } from "./command-registry.js";
import { stripTransportAttachmentFooter, stripTrigger } from "./parser-utils.js";
import { COMMAND_PARSERS } from "./command-parsers.js";

/** Parse a raw text message into an AgentControlCommand, or return null if not a command. */
export function parseControlCommand(text: string, triggerPattern?: RegExp): AgentControlCommand | null {
  if (!text) return null;
  const cleaned = stripTrigger(text, triggerPattern);
  if (!cleaned.startsWith("/") && !cleaned.startsWith("!")) return null;

  const shellBangAlias = cleaned.startsWith("!");
  const command = shellBangAlias ? "!" : cleaned.match(/^\S+/)?.[0];
  if (!command) return null;

  const rawArgs = (shellBangAlias ? cleaned.slice(1) : cleaned.slice(command.length)).replace(/^\s+/, "");
  const normalizedArgs = rawArgs.split(/\s+/).filter(Boolean).join(" ").trim();
  const commandLower = normalizeControlCommandName(command.toLowerCase());

  const parser = COMMAND_PARSERS[commandLower];
  if (!parser) return null;

  const parserArgs = commandLower === "/shell" || commandLower === "/bash"
    ? stripTransportAttachmentFooter(rawArgs)
    : normalizedArgs;

  return parser(parserArgs, cleaned);
}

export function parseSlashCommand(rawText: string): { trimmed: string; rawCommand: string; commandName: string } | null {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("/")) return null;

  const rawCommand = trimmed.slice(1);
  const argIndex = rawCommand.search(/\s/);
  const commandName = argIndex === -1 ? rawCommand : rawCommand.slice(0, argIndex);
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(commandName)) return null;
  return { trimmed, rawCommand, commandName };
}

export function isSlashCommandInvocation(rawText: string): boolean {
  return parseSlashCommand(rawText) !== null;
}
