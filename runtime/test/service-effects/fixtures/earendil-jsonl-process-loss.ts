import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Type } from "typebox";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { AgentHarness, type AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { JsonlSessionRepo, operationState } from "@earendil-works/pi-agent-core/harness/session";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs";

/** Child-only fixture: process.exit deliberately omits close at a durable tool boundary. */
const [root, phase, storedReplay, currentReplay] = process.argv.slice(2);
if (!root || !isAbsolute(root) || !["crash", "resume", "settled"].includes(phase) || !["safe", "never"].includes(storedReplay) || !["safe", "never"].includes(currentReplay)) {
  throw new Error("Explicit owned root, phase and replay declarations required");
}
globalThis.fetch = async () => { throw new Error("Network forbidden in process-loss fixture"); };
const ctx = BACKGROUND_CONTEXT;
const operationId = "01950000-0000-7000-8000-000000000101";
const env = new NodeExecutionEnv({ cwd: root });
const repo = new JsonlSessionRepo({ fileSystem: env, sessionsRoot: "sessions" });
const metadataPath = join(root, "metadata.json");
const session = phase === "crash"
  ? await repo.create({ id: "jsonl-process-loss", cwd: root }, ctx)
  : await repo.open(JSON.parse(readFileSync(metadataPath, "utf8")), ctx);
const callsPath = join(root, "tool-calls.jsonl");
const expectedMemo = { checkpoint: "before-process-loss", deleteMe: false };
const tool: AgentHarnessTool = {
  name: "crash_probe", label: "Crash probe", description: "owned offline fixture", parameters: Type.Object({}),
  replay: (phase === "crash" ? storedReplay : currentReplay) as "safe" | "never",
  async execute(callId, _params, _update, _toolContext, invocation, context) {
    if (context.abortSignal?.aborted) throw new Error("unexpected abort");
    const identity = { callId, invocationId: invocation.invocationId, operationId: invocation.operationId, turnId: invocation.turnId };
    if (phase === "crash") {
      await invocation.setMemo("keep", expectedMemo);
      await invocation.setMemo("remove", "temporary");
      await invocation.setMemo("remove", undefined);
      const memo = await invocation.getMemo("keep");
      if (JSON.stringify(memo) !== JSON.stringify(expectedMemo)) throw new Error("memo not committed before process loss");
      appendFileSync(callsPath, JSON.stringify({ phase, identity, memo }) + "\n");
      const durableState = await session.getValue(operationState(operationId), ctx);
      if (durableState?.value.at !== "tools" || durableState.value.batch.calls[0]?.status !== "effect_pending") throw new Error("expected durable pending tool intent");
      writeFileSync(join(root, "crash-receipt.json"), JSON.stringify({ identity, memo, durableState: durableState.value }));
      process.exit(73);
    }
    const memo = await invocation.getMemo("keep");
    const removed = await invocation.getMemo("remove");
    appendFileSync(callsPath, JSON.stringify({ phase, identity, memo, removedMemoAbsent: removed === undefined }) + "\n");
    if (JSON.stringify(memo) !== JSON.stringify(expectedMemo) || removed !== undefined) throw new Error("memo did not survive process loss");
    return { content: [{ type: "text", text: "replayed-once" }], details: { restored: true } };
  },
};
const faux = fauxProvider();
faux.setResponses(phase === "crash"
  ? [fauxAssistantMessage(fauxToolCall("crash_probe", {}, { id: "call-before-loss" }), { stopReason: "toolUse" })]
  : [fauxAssistantMessage("restored-run-finished")]);
const models = createModels(); models.setProvider(faux.provider);
const created = await AgentHarness.create({ session, models, model: faux.getModel(), tools: [tool] }, ctx);
const lane = await created.harness.lane("main", ctx);
if (phase === "crash") {
  writeFileSync(metadataPath, JSON.stringify(session.metadata));
  const accepted = await lane.accept({ kind: "prompt", operationId, prompt: "exercise process loss" }, ctx);
  if (!accepted.ok) throw accepted.error;
  await lane.drive({ operationId }, ctx);
  throw new Error("crash boundary not reached");
}
try {
  const beforeWatch = await lane.watch(ctx);
  const before = beforeWatch.snapshot; beforeWatch.unsubscribe();
  const result = await lane.drive({ operationId }, ctx);
  if (phase === "resume" && !result.ok) throw result.error;
  const afterWatch = await lane.watch(ctx);
  const after = afterWatch.snapshot; afterWatch.unsubscribe();
  const toolResults = after.transcript.flatMap((entry) => entry.type === "message" && entry.message.role === "toolResult" ? [{ id: entry.id, callId: entry.message.toolCallId, isError: entry.message.isError, content: entry.message.content }] : []);
  writeFileSync(join(root, phase === "settled" ? "settled-receipt.json" : "resume-receipt.json"), JSON.stringify({
    open: created.open, beforeOperation: before.operation?.id, beforeTools: before.operation?.runningTools,
    result, lastResult: after.lastResult, resultById: await lane.getResult(operationId, ctx),
    operationAfter: after.operation, toolResults, providerCalls: faux.state.callCount,
    toolCalls: existsSync(callsPath) ? readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [],
  }, null, 2));
} finally { await created.harness.close(ctx); await repo.close(ctx); await env.cleanup(ctx); }
