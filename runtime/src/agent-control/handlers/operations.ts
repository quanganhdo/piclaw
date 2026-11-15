/**
 * agent-control/handlers/operations.ts – Handlers for /shell and /bash commands.
 *
 * Executes shell commands from the control interface and returns formatted
 * output blocks. Uses the tracked-bash infrastructure for process management.
 *
 * Consumers: agent-control-handlers.ts dispatches to these handlers.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { createTrackedBashOperations } from "../../tools/tracked-bash.js";
import { formatShellBlock, resolveShellCwd } from "../agent-control-helpers.js";

const SHELL_OUTPUT_LIMIT = 20000;
const SHELL_TIMEOUT_SECONDS = 30;

type ShellCommand = Extract<AgentControlCommand, { type: "shell" }>;

/** Handle /shell: execute a shell command with process tracking. */
export async function handleShell(_session: AgentSession | undefined, command: ShellCommand): Promise<AgentControlResult> {
  const rawCommand = command.command?.trim();
  if (!rawCommand) {
    return {
      status: "error",
      message: "Usage: /shell <command>",
    };
  }

  const cwd = resolveShellCwd();
  const bash = createTrackedBashOperations();
  let output = "";
  let truncated = false;

  const onData = (data: Buffer) => {
    if (truncated) return;
    const chunk = data.toString("utf8");
    const remaining = SHELL_OUTPUT_LIMIT - output.length;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    if (chunk.length > remaining) {
      output += chunk.slice(0, remaining);
      truncated = true;
      return;
    }
    output += chunk;
  };

  let exitCode: number | null = null;
  let timedOut = false;
  let errorMessage: string | null = null;

  try {
    const result = await bash.exec(rawCommand, cwd, {
      onData,
      timeout: SHELL_TIMEOUT_SECONDS,
    });
    exitCode = result.exitCode ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("timeout:")) {
      timedOut = true;
    } else if (message !== "aborted") {
      errorMessage = message;
    }
  }

  const meta: string[] = [];
  if (truncated) meta.push("(output truncated)");
  if (timedOut) meta.push(`(timed out after ${SHELL_TIMEOUT_SECONDS}s)`);
  if (exitCode !== null) meta.push(`(exit code ${exitCode})`);
  if (errorMessage) meta.push(`(error: ${errorMessage})`);

  const isSuccess = !timedOut && !errorMessage && (exitCode === null || exitCode === 0);

  return {
    status: isSuccess ? "success" : "error",
    message: formatShellBlock(rawCommand, output, meta),
  };
}
