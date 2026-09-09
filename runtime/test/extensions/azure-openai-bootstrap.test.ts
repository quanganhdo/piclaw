import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import azureOpenAiExtension, { createAzureTokenRefreshCoalescer, startAzureProviderBootstrap, writeAzureTokenCacheFile } from "../../extensions/integrations/azure-openai.ts";

function fakeApi() {
  const handlers: Array<{ event: string; handler: (...args: any[]) => any }> = [];
  const commands = new Map<string, any>();
  const api = {
    on: (event: string, handler: (...args: any[]) => any) => handlers.push({ event, handler }),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerProvider: () => { throw new Error("session extension must not register providers"); },
  } as unknown as ExtensionAPI;
  return { api, handlers, commands };
}

describe("azure-openai bootstrap lifecycle", () => {
  test("default extension is session-scoped only and owns no provider lifecycle", () => {
    const { api, handlers, commands } = fakeApi();
    azureOpenAiExtension(api);
    expect(handlers.map((entry) => entry.event)).toEqual(["context"]);
    expect(commands.has("image")).toBe(true);
    expect(commands.has("flux")).toBe(true);
  });

  test("token cache writes are atomic and private regardless of prior mode", () => {
    const root = mkdtempSync(join(tmpdir(), "piclaw-azure-token-cache-"));
    const cacheFile = join(root, "nested", "aoai-token.json");
    try {
      writeAzureTokenCacheFile(cacheFile, {
        accessToken: "first-secret",
        expiresOn: "1",
        expiresOnEpoch: 1,
      });
      expect(statSync(cacheFile).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toMatchObject({ accessToken: "first-secret" });

      chmodSync(cacheFile, 0o666);
      writeFileSync(cacheFile, "stale", { mode: 0o666 });
      writeAzureTokenCacheFile(cacheFile, {
        accessToken: "second-secret",
        expiresOn: "2",
        expiresOnEpoch: 2,
      });
      expect(statSync(cacheFile).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toMatchObject({ accessToken: "second-secret" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("managed identity token refresh coalesces concurrent callers and releases after settlement", async () => {
    let calls = 0;
    let release!: () => void;
    let entered!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const refresh = async () => {
      calls += 1;
      entered();
      await blocker;
      return { accessToken: `token-${calls}`, expiresOnEpoch: calls };
    };

    const coalescer = createAzureTokenRefreshCoalescer();
    const first = coalescer.run(refresh);
    const second = coalescer.run(refresh);
    expect(first).toBe(second);
    await started;
    expect(calls).toBe(1);
    release();
    expect((await first).accessToken).toBe("token-1");

    expect((await coalescer.run(refresh)).accessToken).toBe("token-2");
    expect(calls).toBe(2);
  });

  test("process bootstrap refresh is explicit and coalesces concurrent callers", async () => {
    let tokenCalls = 0;
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const registrations: string[] = [];
    const bootstrap = startAzureProviderBootstrap((name) => registrations.push(name), {
      staticApiKey: "",
      ensureToken: async () => {
        tokenCalls += 1;
        await blocker;
        return { accessToken: "token", expiresOn: "", expiresOnEpoch: Math.floor(Date.now() / 1000) + 3600 };
      },
      ensureModelCaps: async () => {},
      timerApi: { setTimeout: (() => 1 as any) as any, clearTimeout: () => {} },
    });
    expect(tokenCalls).toBe(0);
    const first = bootstrap.refresh();
    const second = bootstrap.refresh();
    expect(first).toBe(second);
    expect(tokenCalls).toBe(1);
    release();
    await first;
    expect(registrations.length).toBeGreaterThan(0);
    bootstrap.stop();
  });

  test("scheduled refresh rejection is observed and rescheduled without an unhandled rejection", async () => {
    const scheduled: Array<() => void> = [];
    let tokenCalls = 0;
    const bootstrap = startAzureProviderBootstrap(() => {}, {
      staticApiKey: "",
      ensureToken: async () => {
        tokenCalls += 1;
        if (tokenCalls > 1) throw new Error("scheduled token failure");
        return { accessToken: "token", expiresOn: "", expiresOnEpoch: Math.floor(Date.now() / 1000) + 3600 };
      },
      ensureModelCaps: async () => {},
      timerApi: {
        setTimeout: ((fn: () => void) => { scheduled.push(fn); return scheduled.length as any; }) as any,
        clearTimeout: () => {},
      },
    });
    await bootstrap.refresh();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    await Bun.sleep(1);
    expect(tokenCalls).toBe(2);
    expect(scheduled).toHaveLength(1);
    bootstrap.stop();
  });

  test("capability refresh failure retains static provider registration", async () => {
    const registrations: string[] = [];
    const bootstrap = startAzureProviderBootstrap((name) => registrations.push(name), {
      staticApiKey: "",
      ensureToken: async () => ({ accessToken: "token", expiresOn: "", expiresOnEpoch: Math.floor(Date.now() / 1000) + 3600 }),
      ensureModelCaps: async () => { throw new Error("ARM unavailable"); },
      timerApi: { setTimeout: (() => 1 as any) as any, clearTimeout: () => {} },
    });
    await bootstrap.refresh();
    expect(registrations.length).toBeGreaterThan(0);
    bootstrap.stop();
  });
});
