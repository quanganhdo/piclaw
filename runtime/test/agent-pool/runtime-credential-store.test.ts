import { expect, test } from "bun:test";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { createRuntimeCredentialStore } from "../../src/agent-pool/runtime-credential-store.js";
import { classifyOpaqueAgentFailure } from "../../src/agent-pool/automatic-recovery.js";

const sentinel = "PRIVATE-CREDENTIAL-ERROR-SENTINEL";
for (const [name, thrown, expected, category] of [
  ["permanent", new Error(`invalid_grant ${sentinel}`, { cause: new Error(`refresh=${sentinel}`) }), "Provider login required. Model credentials could not be resolved.", "auth_config"],
  ["transient", new Error(`503 refresh_token=${sentinel}`), "Model credential service temporarily unavailable (503).", "network"],
  ["malformed-storage", new SyntaxError(`auth.json ${sentinel}`), "Provider login required. Model credentials could not be resolved.", "auth_config"],
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
    expect(error.message).toBe("Provider login required. Model credentials could not be resolved.");
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
  const error = await store.read("fixture", { signal: AbortSignal.abort() }).catch(error => error);
  expect(error.name).toBe("AbortError"); expect(error.message).toBe("Credential operation aborted.");
  expect(error.cause).toBeUndefined(); expect(classifyOpaqueAgentFailure(error.message)).toBe("aborted");
});
