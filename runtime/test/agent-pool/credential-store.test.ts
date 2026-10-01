import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Credential } from "@earendil-works/pi-ai";
import { FileCredentialStore, isTransientOAuthRefreshError } from "../../src/agent-pool/credential-store.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.js";

const roots: string[] = [];
const expiredOAuth = { type: "oauth", access: "old", refresh: "refresh", expires: 1 } satisfies Credential;
async function createStore(initial: Record<string, Credential> = {}) {
  const root = mkdtempSync(join(tmpdir(), "piclaw-credential-store-"));
  roots.push(root);
  const authPath = join(root, "agent", "auth.json");
  const store = new FileCredentialStore(authPath);
  for (const [provider, credential] of Object.entries(initial)) await store.modify(provider, async () => credential);
  return { authPath, store };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("FileCredentialStore", () => {
  test("rejects linked or non-regular targets without changing outside files", async () => {
    const { authPath, store } = await createStore();
    await store.read("test");
    const outside = `${authPath}.outside`;
    writeFileSync(outside, '{"outside":true}', { mode: 0o644 });
    rmSync(authPath);
    symlinkSync(outside, authPath);
    await expect(new FileCredentialStore(authPath).read("test")).rejects.toThrow("private regular file");
    expect(readFileSync(outside, "utf8")).toBe('{"outside":true}');
    expect(statSync(outside).mode & 0o777).toBe(0o644);
    rmSync(authPath);
    linkSync(outside, authPath);
    await expect(new FileCredentialStore(authPath).read("test")).rejects.toThrow("private regular file");
    rmSync(authPath);
    mkdirSync(authPath);
    await expect(new FileCredentialStore(authPath).read("test")).rejects.toThrow("private regular file");
  });

  test("secures an existing owned credential directory and rejects a directory link", async () => {
    const { authPath, store } = await createStore();
    await store.read("test");
    const parent = join(authPath, "..");
    chmodSync(parent, 0o777);
    await new FileCredentialStore(authPath).read("test");
    expect(statSync(parent).mode & 0o777).toBe(0o700);
    const linked = `${parent}-linked`;
    symlinkSync(parent, linked);
    await expect(new FileCredentialStore(join(linked, "auth.json")).read("test")).rejects.toThrow("real directory");
  });

  test("creates auth.json with private permissions and resolves stored API-key expressions", async () => {
    const { authPath, store } = await createStore({
      openai: { type: "api_key", key: "$OPENAI_API_KEY", env: { OPENAI_API_KEY: "secret" } },
      "openai-codex": { type: "oauth", access: "access", refresh: "refresh", expires: 123, accountId: "acct" },
    });
    expect(statSync(authPath).mode & 0o777).toBe(0o600);
    expect(await store.read("openai")).toEqual({ type: "api_key", key: "secret", env: { OPENAI_API_KEY: "secret" } });
    expect(await store.read("openai-codex")).toMatchObject({ type: "oauth", accountId: "acct" });
    expect(await store.list()).toEqual([{ providerId: "openai", type: "api_key" }, { providerId: "openai-codex", type: "oauth" }]);
  });

  test("supports literal escapes and environment templates without changing persisted config", async () => {
    const { authPath, store } = await createStore({ escaped: { type: "api_key", key: "$$literal-$!bang-${TOKEN}", env: { TOKEN: "value" } } });
    expect(await store.read("escaped")).toEqual({ type: "api_key", key: "$literal-!bang-value", env: { TOKEN: "value" } });
    expect(JSON.parse(readFileSync(authPath, "utf8")).escaped.key).toBe("$$literal-$!bang-${TOKEN}");
  });

  test("matches upstream empty environment fallback semantics", async () => {
    const previous = process.env.PICLAW_CREDENTIAL_STORE_TEST_KEY;
    process.env.PICLAW_CREDENTIAL_STORE_TEST_KEY = "process-value";
    try {
      const { store } = await createStore({ test: { type: "api_key", key: "$PICLAW_CREDENTIAL_STORE_TEST_KEY", env: { PICLAW_CREDENTIAL_STORE_TEST_KEY: "" } } });
      expect(await store.read("test")).toMatchObject({ key: "process-value" });
    } finally {
      if (previous === undefined) delete process.env.PICLAW_CREDENTIAL_STORE_TEST_KEY;
      else process.env.PICLAW_CREDENTIAL_STORE_TEST_KEY = previous;
    }
  });

  test("serializes concurrent mutation and returns the authoritative stored credential", async () => {
    const { store } = await createStore({ test: { type: "api_key", key: "zero", env: { n: "0" } } });
    await Promise.all(Array.from({ length: 12 }, async () => store.modify("test", async (current) => {
      const n = Number(current?.type === "api_key" ? current.env?.n : 0) + 1;
      await Bun.sleep(2);
      return { type: "api_key", key: String(n), env: { n: String(n) } };
    })));
    expect(await store.read("test")).toEqual({ type: "api_key", key: "12", env: { n: "12" } });
  });

  test("cross-instance reads and writes refresh from the locked file", async () => {
    const { authPath, store } = await createStore({ first: { type: "api_key", key: "one" } });
    const other = new FileCredentialStore(authPath);
    await other.modify("second", async () => ({ type: "api_key", key: "two" }));
    expect(await store.read("second")).toEqual({ type: "api_key", key: "two" });
    await store.modify("first", async () => ({ type: "api_key", key: "updated" }));
    expect(await other.read("first")).toEqual({ type: "api_key", key: "updated" });
  });

  test("undefined modify result preserves a concurrently refreshed credential", async () => {
    const { authPath, store } = await createStore({ oauth: { type: "oauth", access: "old", refresh: "r", expires: 1 } });
    const other = new FileCredentialStore(authPath);
    await other.modify("oauth", async () => ({ type: "oauth", access: "new", refresh: "r2", expires: Date.now() + 60_000 }));
    const post = await store.modify("oauth", async (current) => {
      expect(current).toMatchObject({ type: "oauth", access: "new" });
      return undefined;
    });
    expect(post).toMatchObject({ type: "oauth", access: "new" });
  });

  test("retries transient OAuth refresh failures under the same serialized mutation", async () => {
    const delays: number[] = [];
    const { authPath } = await createStore({ oauth: { type: "oauth", access: "old", refresh: "refresh", expires: 1 } });
    const store = new FileCredentialStore(authPath, {
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      random: () => 0.5,
      sleep: async (delayMs) => { delays.push(delayMs); },
    });
    let calls = 0;

    const refreshed = await store.modify("oauth", async (current) => {
      calls += 1;
      expect(current).toMatchObject({ type: "oauth", access: "old", refresh: "refresh" });
      if (calls < 3) throw new Error(calls === 1 ? "fetch failed" : "503 Service Unavailable");
      return { type: "oauth", access: "new", refresh: "rotated", expires: Date.now() + 60_000 };
    });

    expect(calls).toBe(3);
    expect(delays).toEqual([100, 200]);
    expect(refreshed).toMatchObject({ type: "oauth", access: "new", refresh: "rotated" });
    expect(await store.read("oauth")).toMatchObject({ type: "oauth", access: "new", refresh: "rotated" });
  });

  test("retry logs omit provider error diagnostics", async () => {
    const sentinel = "SENTINEL-retry-secret";
    const rawMessage = `503 Service Unavailable https://example.test/?access_token=${sentinel}`;
    const failures: unknown[] = [
      new Error(rawMessage, { cause: new Error(`token=${sentinel}`) }),
      { status: 503, cause: { url: `https://example.test/?token=${sentinel}` } },
    ];
    const logs: LogRecord[] = [];
    const sink = (record: LogRecord) => logs.push(record);
    addLogSink(sink);
    try {
      for (const failure of failures) {
        const { authPath } = await createStore({ oauth: expiredOAuth });
        const store = new FileCredentialStore(authPath, {
          maxRetries: 1, baseDelayMs: 0, random: () => 0, sleep: async () => undefined,
        });
        let attempts = 0;
        await store.modify("oauth", async () => {
          if (++attempts === 1) throw failure;
          return { type: "oauth", access: "new", refresh: "rotated", expires: Date.now() + 60_000 };
        });
        expect(attempts).toBe(2);
      }
    } finally { removeLogSink(sink); }
    const retries = logs.filter((record) => record.operation === "credential_store.oauth_refresh_retry");
    expect(retries).toHaveLength(2);
    for (const record of retries) {
      expect(record).toMatchObject({ level: "warn", module: "agent-pool.credential-store", providerId: "oauth", retryAttempt: 1, maxRetries: 1, delayMs: 0 });
      expect(record).not.toHaveProperty("error");
      expect(record).not.toHaveProperty("cause");
      expect(JSON.stringify(record)).not.toContain(sentinel);
      expect(JSON.stringify(record)).not.toContain(rawMessage);
    }
  });

  test("serializes concurrent refresh contenders around one retry sequence", async () => {
    const { authPath } = await createStore({ oauth: { type: "oauth", access: "old", refresh: "refresh", expires: 1 } });
    const delays: number[] = [];
    const owner = new FileCredentialStore(authPath, {
      maxRetries: 1,
      baseDelayMs: 10,
      random: () => 0.5,
      sleep: async (delayMs) => { delays.push(delayMs); await Bun.sleep(5); },
    });
    const waiter = new FileCredentialStore(authPath, {
      maxRetries: 1,
      sleep: async () => { throw new Error("waiter should not retry"); },
    });
    let ownerCalls = 0;
    let waiterCalls = 0;
    let ownerEntered!: () => void;
    const ownerHasLock = new Promise<void>((resolve) => { ownerEntered = resolve; });

    const ownerResultPromise = owner.modify("oauth", async () => {
      ownerCalls += 1;
      ownerEntered();
      if (ownerCalls === 1) throw new Error("503 Service Unavailable");
      return { type: "oauth", access: "new", refresh: "rotated", expires: Date.now() + 60_000 };
    });
    await ownerHasLock;
    const waiterResultPromise = waiter.modify("oauth", async (current) => {
      waiterCalls += 1;
      expect(current).toMatchObject({ type: "oauth", access: "new", refresh: "rotated" });
      return undefined;
    });

    const [ownerResult, waiterResult] = await Promise.all([ownerResultPromise, waiterResultPromise]);
    expect(ownerCalls).toBe(2);
    expect(waiterCalls).toBe(1);
    expect(delays).toEqual([10]);
    expect(ownerResult).toMatchObject({ type: "oauth", access: "new" });
    expect(waiterResult).toMatchObject({ type: "oauth", access: "new" });
  });

  test("does not retry permanent OAuth refresh failures", async () => {
    const { authPath } = await createStore({ oauth: { type: "oauth", access: "old", refresh: "refresh", expires: 1 } });
    const store = new FileCredentialStore(authPath, {
      maxRetries: 3,
      sleep: async () => { throw new Error("sleep should not run"); },
    });
    for (const message of [
      "400 Bad Request: invalid_grant",
      "401 Unauthorized",
      "refresh token revoked",
    ]) {
      let calls = 0;
      await expect(store.modify("oauth", async () => {
        calls += 1;
        throw new Error(message);
      })).rejects.toThrow(message);
      expect(calls).toBe(1);
    }
    expect(await store.read("oauth")).toMatchObject({ type: "oauth", access: "old", refresh: "refresh" });
  });

  test("does not retry a valid OAuth credential mutation", async () => {
    const { authPath } = await createStore({ oauth: { type: "oauth", access: "valid", refresh: "refresh", expires: Date.now() + 60_000 } });
    const store = new FileCredentialStore(authPath, { maxRetries: 2, sleep: async () => undefined });
    let calls = 0;
    await expect(store.modify("oauth", async () => {
      calls += 1;
      throw new Error("503 Service Unavailable");
    })).rejects.toThrow("503 Service Unavailable");
    expect(calls).toBe(1);
  });

  test("does not retry non-OAuth credential mutations", async () => {
    const { authPath } = await createStore({ api: { type: "api_key", key: "old" } });
    const store = new FileCredentialStore(authPath, { maxRetries: 2, sleep: async () => undefined });
    let calls = 0;
    await expect(store.modify("api", async () => {
      calls += 1;
      throw new Error("503 Service Unavailable");
    })).rejects.toThrow("503 Service Unavailable");
    expect(calls).toBe(1);
  });

  test("classifies nested transient and permanent OAuth errors", () => {
    expect(isTransientOAuthRefreshError(new Error("OAuth refresh failed", { cause: new Error("429 Too Many Requests") }))).toBe(true);
    expect(isTransientOAuthRefreshError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTransientOAuthRefreshError(new Error("OAuth refresh failed", { cause: new Error("400 invalid_grant") }))).toBe(false);
    expect(isTransientOAuthRefreshError(new Error("401 Unauthorized"))).toBe(false);
  });

  test("delete does not overwrite unrelated providers", async () => {
    const { authPath, store } = await createStore({ a: { type: "api_key", key: "a" } });
    const other = new FileCredentialStore(authPath);
    await other.modify("b", async () => ({ type: "api_key", key: "b" }));
    await store.delete("a");
    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({ b: { type: "api_key", key: "b" } });
  });

  test("invalid auth.json is never overwritten by modify", async () => {
    const { authPath, store } = await createStore();
    await store.list();
    writeFileSync(authPath, "not-json", "utf8");
    await expect(store.modify("test", async () => ({ type: "api_key", key: "secret" }))).rejects.toThrow();
    expect(readFileSync(authPath, "utf8")).toBe("not-json");
  });
});
