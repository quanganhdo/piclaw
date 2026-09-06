import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { withTempWorkspaceEnv } from "../helpers.js";
import type { AccessMode } from "../../src/core/config-access.js";
import { withExecutionIdentity, type ExecutionIdentity } from "../../src/core/execution-context.js";
import {
  __setRuntimeModelExecutorForTests,
  getRuntimeModelExecutor,
  installRuntimeModelExecutor,
} from "../../src/extensions/model-execution-runtime.js";

const denial = "Direct model execution is unavailable in multi-user mode.";
const model = { provider: "test", api: "openai-responses", id: "model" } as any;

function claimedIdentity(mode: AccessMode, kind: ExecutionIdentity["provenance"]["kind"] = "interactive"): ExecutionIdentity {
  return {
    mode, username: "alice", displayName: "Alice", role: "admin", rootChatJid: "web:alice",
    provenance: { actorUserId: "alice", ownerUserId: "alice", chatJid: "web:alice", kind, authenticationSessionId: "claimed-login" },
  };
}

async function fixture(run: (configure: (mode: AccessMode) => void, path: string) => Promise<void>): Promise<void> {
  await withTempWorkspaceEnv("direct-model-boundary-", {}, async (workspace) => {
    mkdirSync(join(workspace.workspace, ".piclaw"));
    const path = join(workspace.workspace, ".piclaw/config.json");
    const configure = (mode: AccessMode) => writeFileSync(path, JSON.stringify({ domains: { access: {
      mode,
      ...(mode === "isolated-containers" ? { isolation: {
        component: "backend", backendId: "test", ownerUserId: "alice",
        gatewayUrl: "https://gateway.example", verificationKeyRef: "test-key",
      } } : {}),
    } } }));
    configure("single-user");
    __setRuntimeModelExecutorForTests(null);
    try {
      await run(configure, path);
    } finally {
      __setRuntimeModelExecutorForTests(null);
    }
  });
}

test("retained executor methods deny every multi-user mode before touching provider dependencies or options", async () => {
  await fixture(async (configure) => {
    const calls: string[] = [];
    const unexpected = (stage: string): never => { calls.push(stage); throw new Error(`Unexpected ${stage}`); };
    installRuntimeModelExecutor({
      get streamSimple() { return unexpected("stream lookup"); },
      get completeSimple() { return unexpected("complete lookup"); },
    } as any);
    // Acquisition in single-user mode must not authorise a later invocation.
    const { streamSimple, completeSimple } = getRuntimeModelExecutor()!;
    const options = { get onPayload() { return unexpected("options"); } };
    for (const mode of ["family-shared", "isolated-containers"] as const) {
      configure(mode);
      for (const identity of [null, claimedIdentity("single-user"), ...(["interactive", "scheduled", "followup", "side-prompt", "dream", "delegate"] as const).map((kind) => claimedIdentity(mode, kind))]) {
        withExecutionIdentity(identity, () => {
          expect(() => streamSimple(model, { messages: [] }, options)).toThrow(denial);
          expect(() => completeSimple(model, { messages: [] }, options)).toThrow(denial);
        });
      }
    }
    expect(calls).toEqual([]);
  });
});

test("stale multi-user execution context cannot fall back to single-user direct execution", async () => {
  await fixture(async () => {
    let calls = 0;
    installRuntimeModelExecutor({ streamSimple: () => { calls++; }, completeSimple: () => { calls++; } } as any);
    const executor = getRuntimeModelExecutor()!;
    for (const mode of ["family-shared", "isolated-containers"] as const) {
      await withExecutionIdentity(claimedIdentity(mode), async () => {
        await Promise.resolve();
        expect(() => executor.streamSimple(model, { messages: [] })).toThrow(denial);
        expect(() => executor.completeSimple(model, { messages: [] })).toThrow(denial);
      });
    }
    expect(calls).toBe(0);
  });
});

test("malformed or contradictory config never defaults to single-user direct execution", async () => {
  await fixture(async (_configure, path) => {
    let calls = 0;
    installRuntimeModelExecutor({ streamSimple: () => { calls++; }, completeSimple: () => { calls++; } } as any);
    const executor = getRuntimeModelExecutor()!;
    for (const text of ["{", '{"domains":{"access":{"mode":"unknown"}}}', '{"domains":{"access":{"mode":"isolated-containers"}}}']) {
      writeFileSync(path, text);
      expect(() => executor.streamSimple(model, { messages: [] })).toThrow();
      expect(() => executor.completeSimple(model, { messages: [] })).toThrow();
    }
    expect(calls).toBe(0);
  });
});

test("single-user direct streams and completions retain values, callbacks and sanitisation", async () => {
  await fixture(async () => {
    const stream = { marker: "stream" } as any;
    const result = { content: [{ type: "text", text: "complete" }], stopReason: "stop" } as any;
    const completion = Promise.resolve(result);
    const context = { systemPrompt: "single-user", messages: [] };
    const seen: any[][] = [];
    installRuntimeModelExecutor({
      streamSimple: (...args: any[]) => { seen.push(args); return stream; },
      completeSimple: (...args: any[]) => { seen.push(args); return completion; },
    } as any);
    const executor = getRuntimeModelExecutor()!;
    for (const identity of [null, claimedIdentity("single-user")]) {
      await withExecutionIdentity(identity, async () => {
        const callbacks: string[] = [];
        const signal = new AbortController().signal;
        const options = {
          maxTokens: 123, signal,
          onPayload: async (payload: any) => { callbacks.push("payload"); return { ...payload, caller: true }; },
          onResponse: async () => { callbacks.push("response"); },
        };
        expect(executor.streamSimple(model, context, options)).toBe(stream);
        expect(executor.completeSimple(model, context, options)).toBe(completion);
        expect(await completion).toBe(result);
        for (const [selected, suppliedContext, suppliedOptions] of seen.splice(0)) {
          expect(selected).toBe(model);
          expect(suppliedContext).toBe(context);
          expect(suppliedOptions.signal).toBe(signal);
          expect(suppliedOptions.maxTokens).toBe(123);
          expect(await suppliedOptions.onPayload({ input: [{ type: "message", id: "m1" }, { type: "message", id: "m1" }] }, model))
            .toEqual({ input: [{ type: "message", id: "m1" }, { type: "message" }], caller: true });
          await suppliedOptions.onResponse({ status: 200, headers: {} }, model);
        }
        expect(callbacks).toEqual(["payload", "response", "payload", "response"]);
      });
    }
  });
});
