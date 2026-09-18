import { beforeEach, afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb } from "../../src/db.js";
import {
  readOperationsConfig,
  type OperationsConfig,
} from "../../src/core/config-operations.js";
import { createOperationHost } from "../../src/addons/operation-host.js";
import { AddonOperationService } from "../../src/addons/operation-service.js";
import {
  installAddonRuntimeApi,
  resetAddonRuntimeContributionsForTests,
  setAddonOperationHost,
} from "../../src/addons/runtime-contributions.js";
import { withExternalAddonRegistrationContext } from "../../src/addons/external-routes.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers.js";
import type { RunAgentOptions } from "../../src/agent-pool/contracts.js";

let ws: TempWorkspace;
let config: OperationsConfig;
beforeEach(() => {
  initDatabase();
  getDb().exec(
    "DELETE FROM addon_operation_events;DELETE FROM addon_operations;DELETE FROM budget_caps;",
  );
  ws = createTempWorkspace("operations-host-");
  config = {
    enabled: true,
    grants: [
      {
        addonId: "example",
        principalId: "client",
        target: "echo",
        revision: "r1",
        allowedTools: ["read"],
        timeoutMs: 5000,
        maxToolCalls: 2,
        parentWorkId: null,
        enabled: true,
        approvalRequired: false,
      },
    ],
  };
});
afterEach(() => {
  resetAddonRuntimeContributionsForTests();
  ws.cleanup();
});
const principal = { addonId: "example", principalId: "client" };

test("operations configuration defaults disabled and rejects unknown/widening grant shapes", () => {
  const path = join(ws.base, "config.json");
  expect(readOperationsConfig(path)).toEqual({ enabled: false, grants: [] });
  writeFileSync(path, JSON.stringify({ domains: { operations: config } }));
  expect(readOperationsConfig(path)).toEqual(config);
  for (const grant of [
    { ...config.grants[0], allowedTools: ["read"], maxToolCalls: 0 },
    { ...config.grants[0], extra: true },
    { ...config.grants[0], timeoutMs: 0 },
    { ...config.grants[0], allowedTools: ["read", "read"] },
  ]) {
    writeFileSync(
      path,
      JSON.stringify({
        domains: { operations: { enabled: true, grants: [grant] } },
      }),
    );
    expect(() => readOperationsConfig(path)).toThrow();
  }
});

test("host policy denies disabled, unknown and unapproved callers before model work", async () => {
  let calls = 0;
  const host = createOperationHost(
    {
      runAgent: async () => {
        calls++;
        return { status: "success", result: "ok" };
      },
    },
    () => config,
  );
  config.enabled = false;
  expect((await host.authorize(principal, "echo", "admit")).decision).toBe(
    "rejected",
  );
  config.enabled = true;
  expect(
    (
      await host.authorize(
        { ...principal, principalId: "other" },
        "echo",
        "admit",
      )
    ).decision,
  ).toBe("rejected");
  config.grants[0].approvalRequired = true;
  expect((await host.authorize(principal, "echo", "admit")).decision).toBe(
    "approval_required",
  );
  expect((await host.authorize(principal, "echo", "read")).decision).toBe(
    "allow",
  );
  expect(calls).toBe(0);
});

test("host sends only a dedicated operation session, mandatory tool ceiling, bounded budget and caller signal", async () => {
  const runs: Array<{
    prompt: string;
    chat: string;
    options: RunAgentOptions;
  }> = [];
  const host = createOperationHost(
    {
      runAgent: async (prompt, chat, options) => {
        runs.push({ prompt, chat, options });
        return { status: "success", result: "public answer" };
      },
    },
    () => config,
  );
  const service = new AddonOperationService(host),
    client = service.bind(principal);
  try {
    const admitted = await client.admit({
      target: "echo",
      idempotencyKey: "test",
      text: "untrusted request",
    });
    await service.waitForIdle();
    const run = runs[0];
    expect(run.chat).toBe("operation:" + admitted.operation!.id);
    expect(run.chat).not.toBe("web:default");
    expect(run.options).toMatchObject({
      requireToolCeiling: true,
      budgetExecutionKind: "background",
      budgetWorkId: admitted.operation!.workId,
      maxToolCalls: 2,
      timeoutMs: 5000,
      skipPrePromptCompaction: true,
    });
    expect(run.options.toolCeilingFilter!("read")).toBe(true);
    expect(run.options.toolCeilingFilter!("bash")).toBe(false);
    expect(await run.options.executionAdmissionCheck!()).toBe(true);
    config.grants[0].enabled = false;
    expect(await run.options.executionAdmissionCheck!()).toBe(false);
    await expect(client.get(admitted.operation!.id)).rejects.toThrow(
      "unavailable",
    );
    expect(run.options.abortSignal).toBeInstanceOf(AbortSignal);
  } finally {
    service.shutdown();
    await service.waitForIdle();
  }
});

test("generic ABI registration belongs to startup package, not a caller supplied add-on id", async () => {
  resetAddonRuntimeContributionsForTests();
  setAddonOperationHost(
    createOperationHost(
      { runAgent: async () => ({ status: "success", result: "safe" }) },
      () => config,
    ),
  );
  const api = installAddonRuntimeApi();
  expect(() => api.operations.register()).toThrow("startup");
  const bound = await withExternalAddonRegistrationContext(
    {
      packageName: "@example/piclaw-addon-example",
      entryPath: join(ws.base, "runtime.ts"),
    },
    async () => api.operations.register(),
  );
  const client = bound.forPrincipal("client");
  expect(client.version).toBe(1);
  const other = bound.forPrincipal("unconfigured");
  expect(
    (
      await other.admit({
        target: "echo",
        idempotencyKey: "other",
        text: "test",
      })
    ).admission,
  ).toBe("rejected");
  const receipt = await client.admit({
    target: "echo",
    idempotencyKey: "own",
    text: "test",
  });
  for (let i = 0; i < 50; i++) {
    if ((await client.get(receipt.operation!.id)).status === "completed") break;
    await Bun.sleep(2);
  }
  expect((await client.get(receipt.operation!.id)).status).toBe("completed");
  expect(() => api.operations.register()).toThrow("startup");
});
