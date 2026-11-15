/**
 * test/agent-control/agent-control-operations.test.ts – Tests for /shell and /bash handlers.
 *
 * Verifies shell command execution, output formatting, error handling,
 * and the distinction between /shell (tracked) and /bash (raw) modes.
 */

import { describe, test, expect } from "bun:test";
import "../helpers.js";

import { handleShell } from "../../src/agent-control/handlers/operations.js";

function makeShellCommand(command?: string) {
  return { type: "shell", command, raw: command ? `/shell ${command}` : "/shell" } as any;
}

describe("agent-control operations", () => {
  test("handleShell requires a command", async () => {
    const result = await handleShell({} as any, makeShellCommand());
    expect(result.status).toBe("error");
    expect(result.message).toContain("Usage: /shell <command>");
  });

  test("handleShell runs a command and captures output", async () => {
    const result = await handleShell({} as any, makeShellCommand("printf 'hello'") );
    expect(result.status).toBe("success");
    expect(result.message).toContain("$ printf 'hello'");
    expect(result.message).toContain("hello");
    expect(result.message).toContain("(exit code 0)");
    expect(result.message).toContain("```");
  });

  test("handleShell marks non-zero exit code as error", async () => {
    const result = await handleShell({} as any, makeShellCommand("exit 2"));
    expect(result.status).toBe("error");
    expect(result.message).toContain("(exit code 2)");
    expect(result.message).toContain("```");
  });

  test("handleShell truncates long output", async () => {
    const result = await handleShell(
      {} as any,
      makeShellCommand("printf 'A%.0s' {1..21000}")
    );
    expect(result.message).toContain("(output truncated)");
  });

});
