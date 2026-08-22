import { expect, test } from "bun:test";

import { TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT } from "../../src/agent-pool/context-pressure-retry.js";
import {
  PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE,
  runWithProtectedRecoveryHandoff,
} from "../../src/agent-pool/protected-recovery-handoff.js";
import {
  buildProtectedRecoveryControlIntentBlock,
  isProtectedRecoveryControlMessage,
  resolveProtectedRecoveryControlIntent,
  resolveProtectedRecoveryPrompt,
} from "../../src/agent-pool/protected-recovery-control-intent.js";
import type { AgentOutput } from "../../src/agent-pool/contracts.js";

const protectedOutput = (strategyHistory: string[] = []): AgentOutput => ({
  status: "error",
  result: null,
  error: "Protected recovery needs an ordinary turn.",
  requiresToolEnabledContinuation: true,
  recovery: strategyHistory.length > 0
    ? {
        attemptsUsed: 1,
        totalElapsedMs: 1,
        recovered: false,
        exhausted: true,
        lastClassifier: "tool_activity",
        strategyHistory,
        diagnostics: [],
      }
    : undefined,
});

test("protected recovery runs exactly one ordinary continuation at the AgentPool boundary", async () => {
  const prompts: string[] = [];
  const observed: AgentOutput[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1
        ? protectedOutput()
        : { status: "success", result: "finished with tools" };
    },
    (output) => observed.push(output),
  );

  expect(prompts).toEqual(["finish the task", TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT]);
  expect(observed).toHaveLength(2);
  expect(final).toMatchObject({ status: "success", result: "finished with tools" });
});

test("protected handoff preserves pre-tool progress but hides unauthoritative terminal prose", async () => {
  const delivered: string[] = [];
  const prompts: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    { onTurnComplete: (turn) => delivered.push(turn.text) },
    async (prompt, options) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        options.onTurnComplete?.({ text: "committed tool progress", attachments: [], followedByToolUse: true });
        options.onTurnComplete?.({ text: "protected terminal prose", attachments: [] });
        return protectedOutput();
      }
      options.onTurnComplete?.({ text: "ordinary result", attachments: [] });
      return { status: "success", result: "ordinary result" };
    },
  );

  expect(prompts).toEqual(["finish the task", TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT]);
  expect(delivered).toEqual(["committed tool progress", "ordinary result"]);
  expect(final.result).toBe("ordinary result");
});

test("initial turns flush normally when no handoff is required", async () => {
  const delivered: string[] = [];
  await runWithProtectedRecoveryHandoff(
    "finish the task",
    { onTurnComplete: (turn) => delivered.push(turn.text) },
    async (_prompt, options) => {
      options.onTurnComplete?.({ text: "normal result", attachments: [] });
      return { status: "success", result: "normal result" };
    },
  );

  expect(delivered).toEqual(["normal result"]);
});

test("web defers protected recovery without publishing its tool-free terminal prose", async () => {
  const prompts: string[] = [];
  const delivered: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {
      deferToolEnabledContinuation: true,
      onTurnComplete: (turn) => delivered.push(turn.text),
    },
    async (prompt, options) => {
      prompts.push(prompt);
      options.onTurnComplete?.({ text: "committed tool progress", attachments: [], followedByToolUse: true });
      options.onTurnComplete?.({ text: "tools are unavailable in this recovered turn", attachments: [] });
      return protectedOutput();
    },
  );

  expect(prompts).toEqual(["finish the task"]);
  expect(delivered).toEqual(["committed tool progress"]);
  expect(final.requiresToolEnabledContinuation).toBe(true);
});

test("the generated ordinary continuation cannot chain an unprepared recovery", async () => {
  const prompts: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt) => {
      prompts.push(prompt);
      return protectedOutput();
    },
  );

  expect(prompts).toEqual(["finish the task", TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT]);
  expect(final.requiresToolEnabledContinuation).toBeUndefined();
  expect(final.result).toBe(PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE);
});

test("a compacted generated continuation receives one final tool-enabled handoff", async () => {
  const prompts: string[] = [];
  const depths: Array<number | undefined> = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt, options) => {
      prompts.push(prompt);
      depths.push(options.protectedRecoveryContinuationDepth);
      if (prompts.length === 1) return protectedOutput();
      if (prompts.length === 2) return protectedOutput(["compact_then_retry"]);
      return { status: "success", result: "finished after compaction" };
    },
  );

  expect(prompts).toEqual([
    "finish the task",
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
  ]);
  expect(depths).toEqual([undefined, 1, 2]);
  expect(final).toMatchObject({ status: "success", result: "finished after compaction" });
});

test("a second compacted continuation stops at the bounded handoff limit", async () => {
  const prompts: string[] = [];
  const final = await runWithProtectedRecoveryHandoff(
    "finish the task",
    {},
    async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1
        ? protectedOutput()
        : protectedOutput(["compact_then_retry"]);
    },
  );

  expect(prompts).toHaveLength(3);
  expect(final.requiresToolEnabledContinuation).toBeUndefined();
  expect(final.result).toBe(PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE);
});

test("a typed continuation only hands off again after compaction", async () => {
  let calls = 0;
  const final = await runWithProtectedRecoveryHandoff(
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    { protectedRecoveryContinuation: true, protectedRecoveryContinuationDepth: 1 },
    async () => {
      calls += 1;
      return protectedOutput();
    },
  );

  expect(calls).toBe(1);
  expect(final.requiresToolEnabledContinuation).toBeUndefined();
  expect(final.result).toBe(PROTECTED_RECOVERY_HANDOFF_LIMIT_MESSAGE);
});

test("protected recovery control authority requires the complete typed block", () => {
  const block = buildProtectedRecoveryControlIntentBlock({
    sourceMessageId: "source-message",
    sourceRowId: 41,
    threadId: 41,
  });

  expect(isProtectedRecoveryControlMessage({ content_blocks: [block] })).toBe(true);
  expect(resolveProtectedRecoveryControlIntent({ content_blocks: [block] })?.handoff_depth).toBe(1);
  expect(resolveProtectedRecoveryPrompt({ content_blocks: [block] })).toBe(TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ ...block, label: "Presentation text may change" }],
  })).toBe(true);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ type: "control_intent", intent: "protected_recovery_continuation" }],
  })).toBe(false);
  expect(isProtectedRecoveryControlMessage({
    content_blocks: [{ ...block, schema_version: 2 }],
  })).toBe(false);
});

test("matching continuation prose does not acquire one-shot control authority", async () => {
  const prompts: string[] = [];
  await runWithProtectedRecoveryHandoff(
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    {},
    async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1 ? protectedOutput() : { status: "success", result: "done" };
    },
  );

  expect(prompts).toEqual([
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
    TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT,
  ]);
});
