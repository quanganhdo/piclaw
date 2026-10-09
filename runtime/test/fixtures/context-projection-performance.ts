import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mock } from "bun:test";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";

// Executed in a child process: module mocks cannot replace real configuration,
// authorisation or model execution modules in neighbouring test suites.
assertPathWithinTestFilesystemIsolation(process.env.PICLAW_WORKSPACE!, process.env, { allowRoot: false });
let allowed = true;
let enabled = true;
let tools = ["bash"];
let thresholds: Record<string, { bytes?: number; lines?: number }> = {};
let accessReads = 0, toolReads = 0, thresholdReads = 0, stored = 0, modelCalls = 0;
let onAccess: () => void = () => {};
const modulePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

mock.module(modulePath("../../src/extensions/context-mode-api.ts"), () => ({
  buildPreview: (text: string, lines: number, chars: number) => text.split("\n").slice(0, lines).map(line => line.slice(0, chars)).join("\n"),
  canUseToolOutput: () => { accessReads++; onAccess(); return allowed; },
  createToolOutputAccessGuard: () => Object.assign(() => { if (!allowed) throw Error("denied"); }, { cacheKey: "test" }),
  ToolOutputAccessDenied: class extends Error {},
  createBatchExecTool: () => ({ name: "batch_exec" }),
  createToolOutputSearchTool: () => ({ name: "search_tool_output" }),
  getToolResultCompactionEnabled: () => enabled,
  getToolResultCompactionTools: () => { toolReads++; return tools; },
  getToolResultCompactionThresholdsByTool: () => { thresholdReads++; return thresholds; },
  getToolResultSemanticSummaryConfig: () => ({ enabled: true, maxInputChars: 12000, maxTokens: 320, timeoutMs: 100 }),
  readToolOutputFile: () => null,
  saveToolOutput: () => { stored++; throw Error("projection must not store"); },
}));
mock.module(modulePath("../../src/core/config.ts"), () => ({
  getToolOutputPresentationConfig: () => ({ storeBytes: 100, storeLines: 10, previewLines: 2, previewLineChars: 40 }),
}));
mock.module(modulePath("../../src/extensions/model-execution-runtime.ts"), () => ({
  getRuntimeModelExecutor: () => ({ completeSimple: () => { modelCalls++; throw Error("projection must not call model"); } }),
}));
const { default: register } = await import("../../extensions/integrations/context-mode.ts");
let hook: (event: any, ctx: any) => Promise<any>;
register({ registerTool() {}, on(name: string, fn: typeof hook) { if (name === "context") hook = fn; } });
assert.equal(typeof hook!, "function");
const text = (value: string) => ({ type: "text", text: value });
const message = (value = "x".repeat(150), tool = "bash") => ({ role: "toolResult", toolName: tool, content: [text(value)] as any[] });

export async function runScenario(scenario: string): Promise<void> {
  if (scenario.startsWith("publication-")) {
    const [, action, timing, shape, rawCount] = scenario.split("-");
    assert(["revoke", "abort"].includes(action));
    assert(["immediate", "microtask", "macrotask"].includes(timing));
    assert(["legacy", "nested"].includes(shape));
    const count = Number(rawCount);
    assert([1, 64, 65].includes(count));
    const messages = Array.from({ length: count }, () => shape === "legacy" ? message() : {
      role: "assistant", content: [{ type: "wrapper", content: [{ type: "tool_result", name: "bash", content: [text("z".repeat(150))] }] }],
    });
    const before = JSON.stringify(messages);
    // Positive control ensures denial cannot pass by skipping eligible output.
    assert.equal((await hook({ messages }, {})).messages.length, count);
    const controller = new AbortController();
    const revoke = () => { if (action === "abort") controller.abort(); else allowed = false; };
    // A previously queued event-loop callback must run before final publication.
    if (timing === "macrotask") setImmediate(revoke);
    const pending = hook({ messages }, { signal: controller.signal });
    if (timing === "immediate") revoke();
    if (timing === "microtask") queueMicrotask(revoke);
    assert.deepEqual(await pending, {});
    assert.equal(JSON.stringify(messages), before);
    assert.equal(stored, 0); assert.equal(modelCalls, 0);
    return;
  }
  switch (scenario) {
    case "bounded-reads": {
      const messages = Array.from({ length: 1024 }, () => message("small"));
      assert.deepEqual(await hook({ messages }, {}), {});
      assert.equal(toolReads, 1); assert.equal(thresholdReads, 1);
      assert.equal(accessReads, 17); // entry + 15 batch boundaries + publication
      break;
    }
    case "event-loop-yield": {
      let yielded = false;
      setImmediate(() => { yielded = true; });
      await hook({ messages: Array.from({ length: 128 }, () => message("small")) }, {});
      assert.equal(yielded, true);
      break;
    }
    case "deterministic-output": {
      const original = message(), before = JSON.stringify(original);
      const result = await hook({ messages: [original] }, {});
      assert.equal(result.messages[0].content[0].text, "Legacy tool output compacted for provider context (1 lines, 150 B).\n\nPreview:\n" + "x".repeat(40));
      assert.equal(JSON.stringify(original), before);
      assert.deepEqual(await hook({ messages: [original] }, {}), result);
      break;
    }
    case "nested-output": {
      const original = { role: "assistant", content: [{ type: "wrapper", content: [{ type: "tool_result", name: "bash", content: [text("z".repeat(150))] }] }] };
      const before = JSON.stringify(original), result = await hook({ messages: [original] }, {});
      assert.match(result.messages[0].content[0].content[0].content[0].text, /Legacy tool output compacted/);
      assert.equal(JSON.stringify(original), before);
      break;
    }
    case "preserve-ineligible": {
      const image = message(); image.content.push({ type: "image", data: "AAA" });
      const binary = message(); binary.content.push({ type: "file", data: "AAA" });
      assert.deepEqual(await hook({ messages: [image, binary, message("small"), message(undefined, "read"), null] }, {}), {});
      break;
    }
    case "fresh-policy": {
      thresholds = { bash: { bytes: 200, lines: 20 } };
      assert.deepEqual(await hook({ messages: [message()] }, {}), {});
      thresholds = { bash: { bytes: 10, lines: 20 } };
      assert.equal((await hook({ messages: [message()] }, {})).messages.length, 1);
      tools = [];
      assert.deepEqual(await hook({ messages: [message()] }, {}), {});
      assert.equal(toolReads, 3); assert.equal(thresholdReads, 3);
      break;
    }
    case "entry-gates": {
      allowed = false; assert.deepEqual(await hook({ messages: [message()] }, {}), {});
      allowed = true; enabled = false; assert.deepEqual(await hook({ messages: [message()] }, {}), {});
      enabled = true; assert.deepEqual(await hook({}, {}), {});
      const controller = new AbortController(); controller.abort();
      assert.deepEqual(await hook({ messages: [message()] }, { signal: controller.signal }), {});
      assert.equal(toolReads, 0); assert.equal(thresholdReads, 0);
      break;
    }
    case "revoke-at-yield": {
      setImmediate(() => { allowed = false; });
      assert.deepEqual(await hook({ messages: Array.from({ length: 128 }, () => message()) }, {}), {});
      assert.equal(accessReads, 2);
      break;
    }
    case "abort-at-yield": {
      const controller = new AbortController(); setImmediate(() => controller.abort());
      assert.deepEqual(await hook({ messages: Array.from({ length: 128 }, () => message()) }, { signal: controller.signal }), {});
      break;
    }
    case "revoke-before-publish": {
      onAccess = () => { if (accessReads === 2) allowed = false; };
      assert.deepEqual(await hook({ messages: [message()] }, {}), {});
      assert.equal(accessReads, 2);
      break;
    }
    case "policy-request-snapshot": {
      setImmediate(() => { tools = []; thresholds = {}; });
      const messages = Array.from({ length: 128 }, () => message());
      assert.equal((await hook({ messages }, {})).messages.length, 128);
      assert.deepEqual(await hook({ messages }, {}), {});
      break;
    }
    default: throw Error("Unknown fixture scenario");
  }
  assert.equal(stored, 0);
  assert.equal(modelCalls, 0);
}
