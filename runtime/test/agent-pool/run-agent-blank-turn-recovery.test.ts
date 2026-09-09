import { expect, test } from "bun:test";

import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import { getAttachmentRegistry } from "../../src/agent-pool/attachments.js";
import { AgentTurnCoordinator } from "../../src/agent-pool/turn-coordinator.js";
import { initDatabase } from "../../src/db.js";
import { runAgentPrompt } from "../../src/agent-pool/run-agent-orchestrator.js";
import { getTestWorkspace, setEnv } from "../helpers.js";
import { join } from 'node:path';
const logsDir = join(getTestWorkspace().data, 'logs');

function createRuntime(session: any, retrySettings?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number }): AgentSessionRuntime {
  return {
    session,
    cwd: "/workspace",
    diagnostics: [],
    services: {
      settingsManager: {
        getRetrySettings: () => ({
          enabled: retrySettings?.enabled ?? true,
          maxRetries: retrySettings?.maxRetries ?? 3,
          baseDelayMs: retrySettings?.baseDelayMs ?? 1,
          maxDelayMs: retrySettings?.maxDelayMs ?? 100,
        }),
      },
    } as any,
    modelFallbackMessage: undefined,
    newSession: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {},
  } as any;
}

test("runAgentPrompt retries a blank user-only session delta and returns the recovered reply", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  try {
    const attachments = getAttachmentRegistry();
    attachments.clear("web:default");

    class StubSession {
      private listeners: Array<(event: any) => void> = [];
      sessionManager = {
        getLeafId: () => "leaf-1",
        getEntries: () => this.entries,
      };
      isStreaming = false;
      isCompacting = false;
      isRetrying = false;
      promptCalls = 0;
      private entries: Array<any> = [];

      subscribe(listener: (event: any) => void) {
        this.listeners.push(listener);
        return () => {
          this.listeners = this.listeners.filter((entry) => entry !== listener);
        };
      }

      async prompt() {
        this.promptCalls += 1;
        this.entries.push({ type: "message", message: { role: "user" } });

        if (this.promptCalls === 1) {
          return;
        }

        this.entries.push({ type: "message", message: { role: "assistant" } });
        for (const listener of this.listeners) {
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered answer" } });
        }
      }

      async abort() {}
    }

    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: (chatJid) => attachments.take(chatJid),
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("yes", "web:default", { timeoutMs: 0, skipPrePromptCompaction: true }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: (chatJid) => attachments.clear(chatJid),
      takeAttachments: (chatJid) => attachments.take(chatJid),
      logsDir,
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(session.promptCalls).toBe(2);
    expect(result.status).toBe("success");
    expect(result.result).toBe("recovered answer");
    expect(result.recovery?.attemptsUsed).toBe(1);
    expect(result.recovery?.recovered).toBe(true);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt retries a blank turn below the configured context threshold without compaction", async () => {
  initDatabase();
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "1",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
    PICLAW_COMPACTION_THRESHOLD_PERCENT: "80",
    PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS: "0",
  });

  try {
    class StubSession {
      private listeners: Array<(event: any) => void> = [];
      private entries: Array<any> = [];
      sessionManager = {
        getLeafId: () => "leaf-below-threshold",
        getEntries: () => this.entries,
        buildSessionContext: () => ({ messages: this.entries.map((entry) => entry.message) }),
      };
      model = { provider: "github-copilot", id: "large-context", contextWindow: 100_000 };
      isStreaming = false;
      isCompacting = false;
      isRetrying = false;
      promptCalls = 0;
      compactCalls = 0;
      getContextUsage = () => ({ tokens: 65_000 });

      subscribe(listener: (event: any) => void) {
        this.listeners.push(listener);
        return () => {
          this.listeners = this.listeners.filter((entry) => entry !== listener);
        };
      }

      async prompt() {
        this.promptCalls += 1;
        this.entries.push({ type: "message", message: { role: "user", content: "continue" } });
        if (this.promptCalls === 1) return;
        this.entries.push({ type: "message", message: { role: "assistant", content: "recovered without compaction" } });
        for (const listener of this.listeners) {
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "recovered without compaction" } });
        }
      }

      async compact() {
        this.compactCalls += 1;
      }

      async abort() {}
    }

    const session = new StubSession();
    const result = await runAgentPrompt("continue", "web:blank-below-threshold", {
      timeoutMs: 0,
      skipPrePromptCompaction: true,
    }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator: new AgentTurnCoordinator({ takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {} }),
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir,
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(result.status).toBe("success");
    expect(result.result).toBe("recovered without compaction");
    expect(result.recovery).toEqual(expect.objectContaining({
      attemptsUsed: 1,
      recovered: true,
      strategyHistory: ["retry"],
    }));
    expect(session.promptCalls).toBe(2);
    expect(session.compactCalls).toBe(0);
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt treats terminal UI side-effect tools as successful even after lead-in text", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  try {
    class StubSession {
      private listeners: Array<(event: any) => void> = [];
      sessionManager = {
        getLeafId: () => "leaf-1",
        getEntries: () => this.entries,
      };
      isStreaming = false;
      isCompacting = false;
      isRetrying = false;
      promptCalls = 0;
      private entries: Array<any> = [];

      subscribe(listener: (event: any) => void) {
        this.listeners.push(listener);
        return () => {
          this.listeners = this.listeners.filter((entry) => entry !== listener);
        };
      }

      async prompt() {
        this.promptCalls += 1;
        this.entries.push({ type: "message", message: { role: "user" } });
        this.entries.push({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "I'll post a widget." }] } });
        for (const listener of this.listeners) {
          listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "I'll post a widget." } });
          listener({ type: "tool_execution_end", toolName: "send_dashboard_widget", toolCallId: "tool-1", isError: false });
          listener({ type: "message_end", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", name: "send_dashboard_widget" }] } });
        }
      }

      async abort() {}
    }

    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("post widget", "web:default", { timeoutMs: 0, skipPrePromptCompaction: true }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir,
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(session.promptCalls).toBe(1);
    expect(result.status).toBe("tool_complete");
    expect(result.recovery).toBeUndefined();
  } finally {
    restoreEnv();
  }
});

test("runAgentPrompt exhausts recovery when repeated blank user-only deltas persist", async () => {
  const restoreEnv = setEnv({
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "1",
    PICLAW_TURN_TRANSIENT_RECOVERY_TOOLS_ENABLED: "1",
    PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS: "2",
    PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS: "30000",
  });

  try {
    class StubSession {
      private listeners: Array<(event: any) => void> = [];
      sessionManager = {
        getLeafId: () => "leaf-1",
        getEntries: () => this.entries,
      };
      isStreaming = false;
      isCompacting = false;
      isRetrying = false;
      promptCalls = 0;
      private entries: Array<any> = [];

      subscribe(listener: (event: any) => void) {
        this.listeners.push(listener);
        return () => {
          this.listeners = this.listeners.filter((entry) => entry !== listener);
        };
      }

      async prompt() {
        this.promptCalls += 1;
        this.entries.push({ type: "message", message: { role: "user" } });
      }

      async abort() {}
    }

    const session = new StubSession();
    const turnCoordinator = new AgentTurnCoordinator({
      takeAttachments: () => [],
      touchSession: () => {},
      recordMessageUsage: () => {},
    });

    const result = await runAgentPrompt("yes", "web:default", { timeoutMs: 0, skipPrePromptCompaction: true }, {
      getOrCreateRuntime: async () => createRuntime(session) as any,
      turnCoordinator,
      clearAttachments: () => {},
      takeAttachments: () => [],
      logsDir,
      setActiveForkBaseLeaf: () => {},
      clearActiveForkBaseLeaf: () => {},
    });

    expect(session.promptCalls).toBe(3);
    expect(result.status).toBe("error");
    expect(result.error).toContain("without emitting an assistant reply");
    expect(result.recovery?.attemptsUsed).toBe(2);
    expect(result.recovery?.exhausted).toBe(true);
  } finally {
    restoreEnv();
  }
});
