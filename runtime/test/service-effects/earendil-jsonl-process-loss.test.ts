import "../helpers.js";
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";

const fixture = join(import.meta.dir, "fixtures", "earendil-jsonl-process-loss.ts");
const operationId = "01950000-0000-7000-8000-000000000101";
async function child(root: string, phase: string, stored: string, current: string) {
  const home = join(root, "home"); mkdirSync(home, { recursive: true });
  const process = Bun.spawn([Bun.which("bun")!, fixture, root, phase, stored, current], {
    cwd: root, stdout: "pipe", stderr: "pipe",
    env: { PATH: "/usr/local/lib/bun/bin:/usr/bin:/bin", HOME: home, PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true", PICLAW_DB_IN_MEMORY: "1" },
  });
  const timeout = setTimeout(() => process.kill("SIGKILL"), 10_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    return { exit, stdout, stderr };
  } finally { clearTimeout(timeout); }
}

for (const [stored, current, shouldReplay] of [
  ["safe", "safe", true], ["never", "safe", false], ["safe", "never", false], ["never", "never", false],
] as const) {
  test(`HC-004/HC-005/HC-022 JSONL process loss: persisted ${stored}, current ${current}`, async () => {
    const workspace = createTempWorkspace("earendil-jsonl-process-loss-");
    try {
      const crash = await child(workspace.base, "crash", stored, current);
      expect(crash.stderr).toBe("");
      expect(crash.exit).toBe(73);
      const before = JSON.parse(readFileSync(join(workspace.base, "crash-receipt.json"), "utf8"));
      expect(before.identity.operationId).toBe(operationId);
      expect(before.identity.callId).toBe("call-before-loss");
      expect(before.identity.invocationId).toEqual(expect.any(String));
      expect(before.identity.invocationId.length).toBeGreaterThan(0);
      expect(before.durableState.batch.turnId).toBe(before.identity.turnId);
      expect(before.durableState.batch.calls).toHaveLength(1);
      expect(before.durableState.batch.calls[0]).toMatchObject({ status: "effect_pending", replay: stored });
      expect(before.durableState.batch.calls[0].resultEntryId).toEqual(expect.any(String));
      expect(before.durableState.batch.calls[0].resultEntryId.length).toBeGreaterThan(0);
      expect(before.durableState.batch.calls[0].resultEntryId).toBe(before.identity.invocationId);
      expect(before.checkpoint).toMatchObject({ content: [{ type: "text", text: "durable checkpoint" }], details: { checkpoint: 1 } });
      const resumed = await child(workspace.base, "resume", stored, current);
      expect(resumed.stderr).toBe("");
      expect(resumed.exit).toBe(0);
      const after = JSON.parse(readFileSync(join(workspace.base, "resume-receipt.json"), "utf8"));
      expect(after.open).toEqual([expect.objectContaining({ lane: "main", operationId, kind: "run" })]);
      expect(after.beforeOperation).toBe(operationId);
      expect(after.toolCalls).toHaveLength(shouldReplay ? 2 : 1);
      if (shouldReplay) {
        expect(after.toolCalls[1].identity).toEqual(before.identity);
        expect(after.toolCalls[1].memo).toEqual(before.memo);
        expect(after.toolCalls[1].removedMemoAbsent).toBe(true);
      }
      expect(after.toolResults).toHaveLength(1);
      expect(after.toolResults[0].callId).toBe("call-before-loss");
      expect(after.toolResults[0].id).toBe(before.durableState.batch.calls[0].resultEntryId);
      expect(after.toolResults[0].isError).toBe(!shouldReplay);
      if (shouldReplay) expect(after.toolResults[0].content).toEqual([{ type: "text", text: "replayed-once" }]);
      else expect(JSON.stringify(after.toolResults[0].content)).toContain("interrupted");
      expect(after.operationAfter).toBeNull();
      expect(after.checkpointAfter).toBeUndefined();
      expect(after.result.value.kind).toBe("settled");
      expect(after.resultById).toEqual(after.lastResult);
      expect(after.providerCalls).toBe(1);
      const settledRun = await child(workspace.base, "settled", stored, current);
      expect(settledRun.stderr).toBe("");
      expect(settledRun.exit).toBe(0);
      const settled = JSON.parse(readFileSync(join(workspace.base, "settled-receipt.json"), "utf8"));
      expect(settled.open).toEqual([]);
      expect(settled.result.ok).toBe(true);
      expect(settled.result.value.kind).toBe("settled");
      expect(settled.checkpointAfter).toBeUndefined();
      expect(settled.toolCalls).toEqual(after.toolCalls);
      expect(settled.toolResults).toEqual(after.toolResults);
      expect(settled.providerCalls).toBe(0);
      expect(settled.lastResult).toEqual(after.lastResult);
      expect(settled.resultById).toEqual(after.resultById);
    } finally { workspace.cleanup(); }
  }, 25_000);
}
