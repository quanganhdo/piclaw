import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { HostCodexModelServices } from "../../durable-engine/src/host-codex-model-services.ts";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.ts";
import { createPromptCacheAuditor, createPromptTransportAuditor, type PromptCacheAudit } from "../../durable-engine/src/host-prompt-cache-audit.ts";

const body = (input = [{ role: "user", content: "PRIVATE-PROMPT" }]) => ({
  model: "model", instructions: "PRIVATE-INSTRUCTIONS", tools: [{ name: "PRIVATE-TOOL" }],
  input, prompt_cache_key: "PRIVATE-CACHE-KEY", reasoning: { effort: "medium", summary: "detailed" },
});
function fixture() {
  const records: PromptCacheAudit[] = [];
  return { records, audit: createPromptCacheAuditor(record => records.push(record)) };
}

test("fingerprints final request without exposing payload or session contents", () => {
  const { records, audit } = fixture();
  audit("PRIVATE-SESSION", body());
  expect(records[0]).toMatchObject({ cacheKeyPresent: true, hadPrevious: false, inputItems: 1, sampledItems: 1, sampleComplete: true });
  expect(JSON.stringify(records)).not.toContain("PRIVATE");
  expect(records[0]!.settingsHash).toMatch(/^[a-f0-9]{64}$/);
});

test("append-only history preserves previous input and counts UTF-8 bytes", () => {
  const { records, audit } = fixture();
  const input = [{ role: "user", content: "Olá 世界" }];
  audit("s", body(input));
  audit("s", body([...input, { role: "assistant", content: "answer" }]));
  expect(records[1]).toMatchObject({ hadPrevious: true, commonItems: 1,
    commonBytes: Buffer.byteLength(JSON.stringify(input[0])), previousSampleItems: 1 });
  expect(records[1]!.inputHash).not.toBe(records[0]!.inputHash);
});

test("distinguishes cache identity, instructions, tools, settings and history changes", () => {
  const { records, audit } = fixture();
  const initial = body();
  audit("s", initial);
  audit("s", { ...initial, prompt_cache_key: undefined, instructions: "changed", tools: [], reasoning: { effort: "high" }, input: [{ role: "user", content: "changed" }] });
  expect(records[1]).toMatchObject({ cacheKeyPresent: false, commonItems: 0, commonBytes: 0 });
  for (const key of ["cacheKeyHash", "instructionsHash", "toolsHash", "settingsHash", "inputHash"]) {
    expect(records[1]![key]).not.toBe(records[0]![key]);
  }
});

test("isolates sessions and evicts bounded least-recently-used state", () => {
  const { records, audit } = fixture();
  for (let i = 0; i < 16; i++) audit(`s${i}`, body());
  audit("s0", body());
  expect(records.at(-1)!.hadPrevious).toBe(true);
  audit("new", body());
  audit("s1", body());
  expect(records.at(-1)!.hadPrevious).toBe(false);
  audit("s0", body());
  expect(records.at(-1)!.hadPrevious).toBe(true);
});

test("bounds samples without claiming a complete input fingerprint", () => {
  const { records, audit } = fixture();
  audit("s", body(Array.from({ length: 4097 }, () => ({ role: "user", content: "x" }))));
  expect(records[0]).toMatchObject({ inputItems: 4097, sampledItems: 4096, sampleComplete: false });
  audit("large", body([{ role: "user", content: "x".repeat(8 * 1024 * 1024) }]));
  expect(records[1]).toMatchObject({ sampledItems: 0, sampleComplete: false });
});

test("malformed data and failed diagnostic sinks never reject provider dispatch", () => {
  const audit = createPromptCacheAuditor(() => { throw Error("log unavailable"); });
  expect(() => audit("s", body())).not.toThrow();
  expect(() => audit("s", undefined)).not.toThrow();
  expect(() => audit("s", { input: [1n] })).not.toThrow();
  expect(() => audit("s", [])).not.toThrow();
});

test("host audit is opt-in, fingerprints final detailed-summary adaptation, and preserves ownership fencing", async () => {
  const model: any = { provider: "openai-codex", id: "model", api: "openai-codex-responses", input: ["text"] };
  const controller = new AbortController();
  let current = true;
  const operation = { id: "op", sessionId: "PRIVATE-HOST-SESSION", cwd: "/unused", model,
    signal: controller.signal, assertCurrent() { if (!current) throw Error("revoked"); } };
  const service = new HostCodexModelServices({
    async capture() { return operation; }, assertAccount() {}, async observe() {}, async flush() {}, preserveHostTools: true,
    routingScope() { return { turnId: "fixture-turn", accountRef: "fixture-account", provider: operation }; },
  }, { createNativeCodexHooks() { return {
    request(payload) { return { ...(payload as object), include: ["adapted-by-addon"] }; },
    headers(headers) { return headers; }, context(messages) { return [...messages]; }, systemPrompt(prompt) { return prompt; },
  }; } });
  const bound = await service.bind(model, controller.signal);
  const records: LogRecord[] = [];
  const sink = (record: LogRecord) => { if (record.module === "durable.prompt-cache") records.push(record); };
  const old = process.env.PICLAW_PROMPT_CACHE_AUDIT;
  addLogSink(sink);
  try {
    delete process.env.PICLAW_PROMPT_CACHE_AUDIT;
    const disabled = bound.options.onPayload(body(), model) as any;
    expect(disabled.reasoning.summary).toBe("detailed");
    expect(records).toHaveLength(0);
    process.env.PICLAW_PROMPT_CACHE_AUDIT = "1";
    const enabled = bound.options.onPayload(body(), model) as any;
    expect(enabled).toEqual(disabled);
    expect(records).toHaveLength(1);
    expect(records[0]!.settingsHash).toBe(createHash("sha256").update(JSON.stringify({
      model: "model", reasoning: { effort: "medium", summary: "detailed" }, include: ["adapted-by-addon"],
    })).digest("hex"));
    expect(JSON.stringify(records)).not.toContain("PRIVATE");
    current = false;
    expect(() => bound.options.onPayload(body(), model)).toThrow("revoked");
    expect(records).toHaveLength(1);
  } finally {
    removeLogSink(sink);
    if (old === undefined) delete process.env.PICLAW_PROMPT_CACHE_AUDIT;
    else process.env.PICLAW_PROMPT_CACHE_AUDIT = old;
  }
});


test("transport fingerprints locate routing/header differences without URL, body or credential values", () => {
  const rows: PromptCacheAudit[] = [], audit = createPromptTransportAuditor(r => rows.push(r));
  const input = "https://PRIVATE_USER:PRIVATE_PASSWORD@api.invalid/private/route?token=PRIVATE_QUERY";
  const init = { headers: { authorization: "Bearer PRIVATE_AUTH", cookie: "PRIVATE_COOKIE", "session-id": "PRIVATE_SESSION", "chatgpt-account-id": "PRIVATE_ACCOUNT", "x-custom-route": "PRIVATE_ROUTE", "x-api-key": "PRIVATE_KEY" }, body: "PRIVATE_BODY" };
  audit("PRIVATE_HOST_SESSION", input, init);
  audit("PRIVATE_HOST_SESSION", input, {...init, headers: {...init.headers, "session-id": "different"}});
  expect(rows[0]!.routeHash).toBe(rows[1]!.routeHash);
  expect(rows[0]!["header-session-id"]).toBeUndefined();
  expect(rows[0]!["header_session-id"]).not.toBe(rows[1]!["header_session-id"]);
  expect(rows[0]!["header_authorization"]).toBeUndefined();expect(rows[0]!["header_cookie"]).toBeUndefined();expect(rows[0]!["header_x-api-key"]).toBeUndefined();
  expect(rows[0]!.wireBytes).toBe(12);
  audit("PRIVATE_HOST_SESSION", input, init, new Response("PRIVATE_RESPONSE", {status:201,headers:{"x-served-by":"PRIVATE_BACKEND"}}));
  expect(rows[2]!.status).toBe(201);expect(rows[2]!.auditType).toBe("response");
  expect(JSON.stringify(rows)).not.toContain("PRIVATE");
  expect(() => createPromptTransportAuditor(() => {throw Error("sink");})("s", input, init)).not.toThrow();
  expect(() => audit("s", "not a URL", init)).not.toThrow();
});


test("wire audit decodes the transmitted zstd body and reports credential changes without fingerprints", () => {
 const rows: PromptCacheAudit[] = [], audit = createPromptTransportAuditor(r=>rows.push(r));
 const payload={instructions:"PRIVATE_INSTRUCTIONS",prompt_cache_key:"PRIVATE_KEY",input:[{role:"user",content:"PRIVATE_PROMPT"}]};
 const init={headers:{authorization:"Bearer PRIVATE_AUTH", "content-encoding":"zstd"},body:Bun.zstdCompressSync(JSON.stringify(payload))};
 audit("s","https://api.invalid",init);audit("s","https://api.invalid",init);
 audit("s","https://api.invalid",{...init,headers:{...init.headers,authorization:"Bearer PRIVATE_OTHER"}});
 expect(rows.map(r=>r.credentialEpoch)).toEqual([1,1,2]);
 expect(rows[0]!.wireInstructionsHash).toBe(createHash("sha256").update(JSON.stringify(payload.instructions)).digest("hex"));
 expect(rows[0]!.wireCacheKeyHash).toBe(createHash("sha256").update(JSON.stringify(payload.prompt_cache_key)).digest("hex"));
 expect(rows[0]!.wireInputPrefixHashes).toContain(createHash("sha256").update(JSON.stringify(payload.input[0])).digest("hex"));
 expect(JSON.stringify(rows)).not.toContain("PRIVATE");
});
