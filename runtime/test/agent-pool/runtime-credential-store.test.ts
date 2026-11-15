import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.js";

import type { CredentialStore } from "@earendil-works/pi-ai";
import { createRuntimeCredentialStore } from "../../src/agent-pool/runtime-credential-store.js";
import { classifyOpaqueAgentFailure } from "../helpers/recovery-classification.js";
import { FileCredentialStore } from "../../src/agent-pool/credential-store.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const logs: LogRecord[] = [];
const sink = (record: LogRecord) => { if (record.module === "agent-pool.runtime-credential-store") logs.push(record); };
beforeEach(() => { logs.length = 0; addLogSink(sink); });
afterEach(() => { removeLogSink(sink); });

const sentinel = "PRIVATE-CREDENTIAL-ERROR-SENTINEL";
const genericError = "Model credential resolution unavailable.";
const storageError = "Model credential storage unavailable.";
for (const [name, thrown, expected, category] of [
  ["permanent", new Error(`invalid_grant ${sentinel}`, { cause: new Error(`refresh=${sentinel}`) }), "Provider login required. Model credentials could not be resolved.", "auth_config"],
  ["transient", new Error(`503 refresh_token=${sentinel}`), "Model credential service temporarily unavailable (503).", "network"],
  ["malformed-storage", new SyntaxError(`auth.json ${sentinel}`), storageError, "credential_storage"],
  ["unknown", new Error(sentinel), genericError, "credential_storage"],
  ["unknown-non-error", { private: sentinel }, genericError, "credential_storage"],
  ["non-error", `invalid_grant ${sentinel}`, "Provider login required. Model credentials could not be resolved.", "auth_config"],
] as const) {
  test(`runtime credential facade sanitizes ${name} across every store operation`, async () => {
    const fail = async () => { throw thrown; };
    const store = createRuntimeCredentialStore({ read: fail, list: fail, modify: fail, delete: fail });
    for (const operation of [() => store.read("fixture"), () => store.list(), () => store.modify("fixture", async current => current), () => store.delete("fixture")]) {
      const error = await operation().catch(error => error);
      expect(error).toBeInstanceOf(Error); expect(error.message).toBe(expected);
      expect(error.cause).toBeUndefined(); expect(JSON.stringify(error)).not.toContain(sentinel);
      expect(error.stack).not.toContain(sentinel); expect(classifyOpaqueAgentFailure(error.message)).toBe(category);
    }
  });
}

for (const property of ["name", "message", "cause", "status", "toString"]) {
  test(`runtime facade fails closed when private diagnostic ${property} inspection throws`, async () => {
    const thrown = property === "status" || property === "toString" ? {} : new Error("private");
    Object.defineProperty(thrown, property, { get: () => { throw new Error(sentinel); } });
    const fail = async () => { throw thrown; };
    const store = createRuntimeCredentialStore({ read: fail, list: fail, modify: fail, delete: fail });
    const error = await store.read("fixture").catch(error => error);
    expect(error.message).toBe(genericError);
    expect(JSON.stringify(logs)).not.toContain(sentinel);
    expect(error.stack).not.toContain(sentinel); expect(error.cause).toBeUndefined();
  });
}

test("runtime facade forwards callback, options and successful credentials without changing store semantics", async () => {
  const credential = { type: "api_key" as const, key: "synthetic-key" };
  const options = { signal: new AbortController().signal };
  const fn = async () => credential;
  const calls: unknown[] = [];
  const underlying: CredentialStore = {
    read: async (...args) => { calls.push(args); return credential; },
    list: async (...args) => { calls.push(args); return [{ providerId: "fixture", type: "api_key" }]; },
    modify: async (...args) => { calls.push(args); return args[1](credential); },
    delete: async (...args) => { calls.push(args); },
  };
  const store = createRuntimeCredentialStore(underlying);
  expect(await store.read("fixture", options)).toBe(credential);
  expect(await store.list(options)).toEqual([{ providerId: "fixture", type: "api_key" }]);
  expect(await store.modify("fixture", fn, options)).toBe(credential);
  await store.delete("fixture", options);
  expect(calls).toEqual([["fixture", options], [options], ["fixture", fn, options], ["fixture", options]]);
});

test("DOMException cancellation retains category without an explicitly aborted signal", async () => {
  const fail = async () => { throw new DOMException(sentinel, "AbortError"); };
  const store = createRuntimeCredentialStore({ read: fail, list: fail, modify: fail, delete: fail });
  const error = await store.read("fixture").catch(error => error);
  expect(error.name).toBe("AbortError"); expect(error.message).toBe("Credential operation aborted.");
  expect(error.cause).toBeUndefined(); expect(error.stack).not.toContain(sentinel);
  expect(classifyOpaqueAgentFailure(error.message)).toBe("aborted");
});

test("aborted credential operations retain cancellation category without provider text", async () => {
  const fail = async () => { throw new Error(`invalid_grant ${sentinel}`); };
  const store = createRuntimeCredentialStore({ read: fail, list: fail, modify: fail, delete: fail });
  const options = { signal: AbortSignal.abort(sentinel) };
  for (const run of [() => store.read(sentinel, options), () => store.list(options), () => store.modify(sentinel, async current => current, options), () => store.delete(sentinel, options)]) {
    const error = await run().catch(error => error);
    expect(error.name).toBe("AbortError"); expect(error.message).toBe("Credential operation aborted.");
    expect(error.cause).toBeUndefined(); expect(classifyOpaqueAgentFailure(error.message)).toBe("aborted");
  }
  expect(logs.map(record => record.category)).toEqual(["aborted", "aborted", "aborted", "aborted"]);
  expect(JSON.stringify(logs)).not.toContain(sentinel);
});

for (const [thrown, category, code, status] of [
  ...["EACCES", "EPERM"].map(code => [Object.assign(new Error(sentinel), { code }), "storage_permissions", code, undefined]),
  ...["ELOCKED", "ECOMPROMISED"].map(code => [Object.assign(new Error(sentinel), { code }), "storage_lock", code, undefined]),
  ...["ENOSPC", "EIO", "ENOENT", "EROFS", "EISDIR"].map(code => [Object.assign(new Error(sentinel), { code }), "storage_io", code, undefined]),
  [new SyntaxError(sentinel), "storage_parse", undefined, undefined],
  [{ code: "ECONNRESET", message: sentinel }, "transient_oauth", "ECONNRESET", undefined],
  [{ code: "EAI_AGAIN", message: sentinel }, "transient_oauth", "EAI_AGAIN", undefined],
  [{ code: "ENETUNREACH", message: sentinel }, "transient_oauth", "ENETUNREACH", undefined],
  [{ status: 503, error_description: sentinel }, "transient_oauth", undefined, 503],
  [{ status: 403, message: sentinel }, "unknown", undefined, 403],
  [{ code: "invalid_grant", message: sentinel }, "auth_rejected", "invalid_grant", undefined],
  [{ statusCode: 401, error_description: sentinel }, "auth_rejected", undefined, 401],
  [new Error(`refresh token revoked ${sentinel}`), "auth_rejected", undefined, undefined],
  [new Error(sentinel, { cause: { code: "invalid_grant" } }), "auth_rejected", "invalid_grant", undefined],
  [{ code: sentinel, status: 123456, message: sentinel }, "unknown", undefined, undefined],
] as const) {
  test(`sanitized logger records ${category}/${code ?? status ?? "no-detail"} for every operation`, async () => {
    const fail = async () => { throw thrown; };
    const store = createRuntimeCredentialStore({ read: fail, list: fail, modify: fail, delete: fail });
    const operations = [() => store.read(sentinel), () => store.list(), () => store.modify(sentinel, async () => undefined), () => store.delete(sentinel)];
    for (const run of operations) {
      const error = await run().catch(error => error);
      expect(error.cause).toBeUndefined();
      expect(error.stack).not.toContain(sentinel);
      expect(error.message.includes("Provider login required")).toBe(category === "auth_rejected");
      expect(classifyOpaqueAgentFailure(error.message)).toBe(category === "transient_oauth" ? "network" : category === "auth_rejected" ? "auth_config" : "credential_storage");
      if (category !== "auth_rejected") expect(error.message).not.toMatch(/login|sign in|missing provider/i);
    }
    expect(logs).toHaveLength(4);
    for (const [index, record] of logs.entries()) {
      const { ts, level, module, message, ...fields } = record;
      expect(fields).toEqual({ event: "credential_store.runtime_failure", operation: ["read", "list", "modify", "delete"][index], category, ...(code ? { code } : {}), ...(status ? { status } : {}) });
    }
    expect(JSON.stringify(logs)).not.toContain(sentinel);
  });
}

for (const property of ["name", "message", "cause", "status", "statusCode", "code", "error", "error_description", "stack", "toString"]) {
  for (const throws of [true, false]) {
    test(`never invokes ${throws ? "throwing" : "secret-returning"} diagnostic getter ${property}`, async () => {
      let calls = 0;
      const thrown = {};
      Object.defineProperty(thrown, property, { get() { calls++; if (throws) throw new Error(sentinel); return sentinel; } });
      const fail = async () => { throw thrown; };
      const error = await createRuntimeCredentialStore({ read: fail, list: fail, modify: fail, delete: fail }).read(sentinel).catch(error => error);
      expect(calls).toBe(0);
      expect(error.message).toBe(genericError);
      expect(JSON.stringify(logs)).not.toContain(sentinel);
      expect(logs[0]?.category).toBe("unknown");
    });
  }
}

test("unknown modify callback failure with a stored token is not an auth rejection", async () => {
  const credential = { type: "oauth" as const, refresh: sentinel, access: sentinel, expires: Date.now() + 600000 };
  const store = createRuntimeCredentialStore({ read: async () => credential, list: async () => [], modify: async (_provider, fn) => fn(credential), delete: async () => {} });
  const error = await store.modify(sentinel, async current => { expect(current).toBe(credential); throw new Error(sentinel); }).catch(error => error);
  expect(error.message).toBe(genericError);
  expect(logs[0]?.category).toBe("unknown");
  expect(JSON.stringify(logs)).not.toContain(sentinel);
});

test("native DOM cancellation does not invoke overridden diagnostic getters", async () => {
  const thrown = new DOMException(sentinel, "AbortError");
  let calls = 0;
  Object.defineProperty(thrown, "name", { get() { calls++; throw new Error(sentinel); } });
  const fail = async () => { throw thrown; };
  const error = await createRuntimeCredentialStore({ read: fail, list: fail, modify: fail, delete: fail }).read(sentinel).catch(error => error);
  expect(error.name).toBe("AbortError");
  expect(calls).toBe(0);
  expect(logs[0]?.category).toBe("aborted");
  expect(JSON.stringify(logs)).not.toContain(sentinel);
});

test("hostile diagnostic proxy cannot replace sanitized failure", async () => {
  const thrown = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(sentinel); } });
  const fail = async () => { throw thrown; };
  const error = await createRuntimeCredentialStore({ read: fail, list: fail, modify: fail, delete: fail }).read(sentinel).catch(error => error);
  expect(error.message).toBe(genericError);
  expect(JSON.stringify(logs)).not.toContain(sentinel);
});

for (const [content, category] of [[`{ invalid JSON ${sentinel}`, "storage_parse"], ["[]", "unknown"]]) {
  test(`real malformed credential file remains ${category}, not login required`, async () => {
    const directory = mkdtempSync(join(process.cwd(), ".credential-facade-"));
    try {
      const path = join(directory, "auth.json");
      writeFileSync(path, content!, { mode: 0o600 });
      const store = createRuntimeCredentialStore(new FileCredentialStore(path));
      for (const run of [() => store.read(sentinel), () => store.list(), () => store.modify(sentinel, async current => current), () => store.delete(sentinel)]) {
        const error = await run().catch(error => error);
        expect(error.message).toBe(category === "storage_parse" ? storageError : genericError);
        expect(classifyOpaqueAgentFailure(error.message)).toBe("credential_storage");
        expect(error.cause).toBeUndefined();
        expect(error.stack).not.toContain(directory);
      }
      expect(logs.map(record => record.category)).toEqual([category, category, category, category]);
      expect(JSON.stringify(logs)).not.toContain(sentinel);
      expect(JSON.stringify(logs)).not.toContain(directory);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test("logger output failure cannot replace sanitized failure", async () => {
  const output = spyOn(process.stderr, "write").mockImplementation(() => { throw new Error(sentinel); });
  try {
    const fail = async () => { throw new Error(sentinel); };
    const error = await createRuntimeCredentialStore({ read: fail, list: fail, modify: fail, delete: fail }).read(sentinel).catch(error => error);
    expect(error.message).toBe(genericError);
    expect(error.stack).not.toContain(sentinel);
  } finally { output.mockRestore(); }
});
