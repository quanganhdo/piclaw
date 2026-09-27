import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  attemptRemoteCompaction,
  stripRemoteCompactionMarker,
  clearRemoteCompactionBackoffForTests,
  extractRemoteCompactionReadableCheckpoint,
  getLatestRemoteCompactionDetails,
  injectRemoteCompactionPayload,
  isRemoteCompactionCompatible,
  mergeRemoteCompactionFileOperations,
  parseRemoteCompactionDetails,
  prependRemoteCompactionPayload,
  REMOTE_COMPACTION_DETAILS_KIND,
  REMOTE_COMPACTION_DETAILS_VERSION,
  REMOTE_COMPACTION_SUMMARY_SENTINEL,
  resolveRemoteCompactionCapability,
  type RemoteCompactionDetails,
} from "./remote-compaction.js";

function model(overrides: Record<string, unknown> = {}): Model<Api> {
  return {
    id: "gpt-5.1",
    name: "Fixture",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_000,
    ...overrides,
  } as Model<Api>;
}

function messages(): AgentMessage[] {
  return [
    { role: "user", content: "preserve this request", timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "preserve this reply" }], api: "openai-responses", provider: "openai", model: "gpt-5.1", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 },
  ] as AgentMessage[];
}

function canonicalOutput(label = "opaque"): Array<Record<string, unknown>> {
  return [
    { type: "message", id: "retained", role: "user", content: [{ type: "input_text", text: label }] },
    { type: "compaction", id: "compact", encrypted_content: `encrypted-${label}` },
  ];
}

function details(overrides: Partial<RemoteCompactionDetails> = {}): RemoteCompactionDetails {
  return {
    kind: REMOTE_COMPACTION_DETAILS_KIND,
    version: REMOTE_COMPACTION_DETAILS_VERSION,
    adapter: "openai-responses-compact",
    provider: "openai",
    modelId: "gpt-5.1",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    output: canonicalOutput(),
    fileOperations: { read: [], written: [], edited: [] },
    createdAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

const auth = { ok: true, apiKey: "test-secret", headers: undefined, source: "api-key" } as const;
const fileOps = { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() };

beforeEach(() => clearRemoteCompactionBackoffForTests());

describe("remote compaction capability gating", () => {
  test("supports only the explicit official OpenAI Responses capability", () => {
    expect(resolveRemoteCompactionCapability(model()).ok).toBe(true);
    expect(resolveRemoteCompactionCapability(model({ id: "arbitrary-name" })).ok).toBe(true);
    expect(resolveRemoteCompactionCapability(model({ provider: "github-copilot", baseUrl: "https://api.githubcopilot.com" })).ok).toBe(false);
    expect(resolveRemoteCompactionCapability(model({ baseUrl: "https://proxy.example/v1" })).ok).toBe(false);
    expect(resolveRemoteCompactionCapability(model({ api: "openai-completions" })).ok).toBe(false);
  });
});

describe("remote compaction request contract", () => {
  test("calls the standalone endpoint and validates canonical opaque output", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const result = await attemptRemoteCompaction({
      model: model(),
      auth,
      messages: messages(),
      fileOps,
      systemPrompt: "system instructions",
      tools: [{ name: "lookup", description: "lookup", parameters: { type: "object" } }],
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      fetchFn: (async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ output: canonicalOutput(), usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } }), { status: 200 });
      }) as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe("https://api.openai.com/v1/responses/compact");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.model).toBe("gpt-5.1");
    expect(body.instructions).toBe("system instructions");
    expect(JSON.stringify(body.input)).toContain("preserve this request");
    expect((capturedInit?.headers as Record<string, string>).authorization).toBe("Bearer test-secret");
    if (result.ok) {
      expect(result.details.output).toEqual(canonicalOutput());
      expect(result.details.fileOperations).toEqual({ read: [], written: [], edited: [] });
      expect(result.details.usage?.totalTokens).toBe(13);
      expect(JSON.stringify(result.details)).not.toContain("test-secret");
    }
  });

  test("prepends previous opaque state and removes the local marker projection", async () => {
    let body: Record<string, unknown> = {};
    const marker = {
      role: "compactionSummary",
      summary: REMOTE_COMPACTION_SUMMARY_SENTINEL,
      tokensBefore: 10,
      timestamp: 1,
    } as unknown as AgentMessage;
    const result = await attemptRemoteCompaction({
      model: model(),
      auth,
      messages: [marker, ...messages()],
      previousDetails: details({ output: canonicalOutput("previous") }),
      fileOps,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      fetchFn: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ output: canonicalOutput("next") }), { status: 200 });
      }) as typeof fetch,
    });
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(body.input);
    expect(serialized).toContain("encrypted-previous");
    expect(serialized).toContain("preserve this request");
    expect(serialized).not.toContain(REMOTE_COMPACTION_SUMMARY_SENTINEL);
  });

  test("preserves an existing local summary during the first native compaction", async () => {
    let body: Record<string, unknown> = {};
    const result = await attemptRemoteCompaction({
      model: model(),
      auth,
      messages: messages(),
      previousSummary: "LEGACY_SUMMARY_SHOULD_BE_INCLUDED",
      fileOps,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      fetchFn: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ output: canonicalOutput("native") }), { status: 200 });
      }) as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(body.input)).toContain("LEGACY_SUMMARY_SHOULD_BE_INCLUDED");
    expect(JSON.stringify(body.input)).toContain("preserve this request");
  });

  test("sanitizes duplicate provider item IDs across persisted and fresh input", async () => {
    let initialBody: Record<string, unknown> = {};
    await attemptRemoteCompaction({
      model: model(),
      auth,
      messages: messages(),
      fileOps,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      fetchFn: (async (_input, init) => {
        initialBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ output: canonicalOutput("initial") }), { status: 200 });
      }) as typeof fetch,
    });
    const freshItemWithId = (initialBody.input as Array<Record<string, unknown>>)
      .find((item) => typeof item?.id === "string");
    expect(freshItemWithId).toBeDefined();
    const duplicateId = freshItemWithId?.id as string;

    let repeatedBody: Record<string, unknown> = {};
    const result = await attemptRemoteCompaction({
      model: model(),
      auth,
      messages: messages(),
      previousDetails: details({
        output: [
          structuredClone(freshItemWithId!),
          { type: "compaction", id: "compact-previous", encrypted_content: "encrypted-previous" },
        ],
      }),
      fileOps,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      fetchFn: (async (_input, init) => {
        repeatedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ output: canonicalOutput("repeated") }), { status: 200 });
      }) as typeof fetch,
    });

    expect(result.ok).toBe(true);
    const repeatedIds = (repeatedBody.input as Array<Record<string, unknown>>)
      .filter((item) => item?.id === duplicateId);
    expect(repeatedIds).toHaveLength(1);
  });

  test("removes orphan function-call outputs from persisted remote state before dispatch", async () => {
    let body: Record<string, unknown> = {};
    const result = await attemptRemoteCompaction({
      model: model(),
      auth,
      messages: messages(),
      previousDetails: details({
        output: [
          { type: "function_call_output", call_id: "call_orphan", output: "secret persisted output" },
          { type: "compaction", id: "compact-previous", encrypted_content: "encrypted-previous" },
        ],
      }),
      fileOps,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      fetchFn: (async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ output: canonicalOutput("repaired") }), { status: 200 });
      }) as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(body.input)).not.toContain("call_orphan");
    expect(JSON.stringify(body.input)).not.toContain("secret persisted output");
    expect(JSON.stringify(body.input)).toContain("encrypted-previous");
  });

  test("applies bounded per-model backoff after a provider failure", async () => {
    clearRemoteCompactionBackoffForTests();
    let clock = 1_000;
    const fetchFn = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    const common = {
      model: model(),
      auth,
      messages: messages(),
      fileOps,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      backoffBaseMs: 100,
      backoffMaxMs: 250,
      now: () => clock,
      fetchFn,
    };
    expect(await attemptRemoteCompaction(common)).toMatchObject({ ok: false, code: "provider_failure" });
    expect(await attemptRemoteCompaction(common)).toMatchObject({ ok: false, code: "backoff", retryAfterMs: 100 });
    clock += 100;
    expect(await attemptRemoteCompaction(common)).toMatchObject({ ok: false, code: "provider_failure" });
    expect(await attemptRemoteCompaction(common)).toMatchObject({ ok: false, code: "backoff", retryAfterMs: 200 });
    clearRemoteCompactionBackoffForTests();
  });

  test("classifies malformed, authentication, provider, and timeout failures", async () => {
    const common = {
      model: model(),
      auth,
      messages: messages(),
      fileOps,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
    };
    const malformed = await attemptRemoteCompaction({
      ...common,
      fetchFn: (async () => new Response(JSON.stringify({ output: [{ type: "message" }] }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(malformed).toMatchObject({ ok: false, code: "malformed" });

    const unauthorized = await attemptRemoteCompaction({
      ...common,
      fetchFn: (async () => new Response("no", { status: 401 })) as unknown as typeof fetch,
    });
    expect(unauthorized).toMatchObject({ ok: false, code: "auth", status: 401 });

    const providerFailure = await attemptRemoteCompaction({
      ...common,
      fetchFn: (async () => new Response("no", { status: 503 })) as unknown as typeof fetch,
    });
    expect(providerFailure).toMatchObject({ ok: false, code: "provider_failure", status: 503 });

    const timedOut = await attemptRemoteCompaction({
      ...common,
      timeoutMs: 5,
      fetchFn: (async (_input, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as typeof fetch,
    });
    expect(timedOut).toMatchObject({ ok: false, code: "timeout" });
  });
});

describe("opaque state persistence and replay", () => {
  test("extracts only Piclaw's marked readable continuity checkpoint", () => {
    const persisted = details();
    persisted.output = [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "do not expose" }] },
      {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: "Earlier context was compacted locally. Preserve this continuity state together with the following events:\n\n## Goal\nKeep this checkpoint.",
        }],
      },
      { type: "compaction", encrypted_content: "encrypted-state" },
    ];

    expect(extractRemoteCompactionReadableCheckpoint(persisted)).toBe("## Goal\nKeep this checkpoint.");

    persisted.output[1] = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Unmarked provider text" }],
    };
    expect(extractRemoteCompactionReadableCheckpoint(persisted)).toBeNull();
  });

  test("round-trips details from the latest branch compaction entry", () => {
    const persisted = details();
    expect(parseRemoteCompactionDetails(JSON.parse(JSON.stringify(persisted)))).toEqual(persisted);
    expect(getLatestRemoteCompactionDetails([
      { type: "message", id: "one", parentId: null, timestamp: "2026-07-15T00:00:00.000Z", message: messages()[0] },
      { type: "compaction", id: "two", parentId: "one", timestamp: "2026-07-15T00:00:01.000Z", summary: REMOTE_COMPACTION_SUMMARY_SENTINEL, firstKeptEntryId: "one", tokensBefore: 10, details: persisted },
    ] as any)).toEqual(persisted);
  });

  test("replaces only the marker item and preserves opaque ordering", () => {
    const payload = {
      model: "gpt-5.1",
      input: [
        { role: "system", content: [{ type: "input_text", text: "prefix" }] },
        { role: "user", content: [{ type: "input_text", text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${REMOTE_COMPACTION_SUMMARY_SENTINEL}\n</summary>` }] },
        { role: "user", content: [{ type: "input_text", text: "kept suffix" }] },
      ],
    };
    const replay = injectRemoteCompactionPayload(payload, model(), details());
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      const input = (replay.payload as { input: unknown[] }).input;
      expect(input).toEqual([payload.input[0], ...canonicalOutput(), payload.input[2]]);
      expect(JSON.stringify(input)).not.toContain(REMOTE_COMPACTION_SUMMARY_SENTINEL);
    }
  });

  test("prepends opaque state for a direct local fallback request", () => {
    const payload = { model: "gpt-5.1", input: [{ role: "user", content: [{ type: "input_text", text: "local fallback prompt" }] }] };
    expect(prependRemoteCompactionPayload(payload, details())).toEqual({
      model: "gpt-5.1",
      input: [...canonicalOutput(), ...payload.input],
    });
  });

  test("drops the marker when a local-fallback provider payload cannot accept opaque input", () => {
    expect(prependRemoteCompactionPayload({ model: "gpt-5.1" }, details())).toEqual({ model: "gpt-5.1" });
  });

  test("merges deterministic file facts for a later local fallback", () => {
    const merged = mergeRemoteCompactionFileOperations(
      { read: new Set(["current-read.ts"]), written: new Set<string>(), edited: new Set(["current-edit.ts"]) },
      details({ fileOperations: { read: ["prior-read.ts"], written: ["prior-write.ts"], edited: ["prior-edit.ts"] } }),
    );
    expect([...merged.read]).toEqual(["prior-read.ts", "current-read.ts"]);
    expect([...merged.written]).toEqual(["prior-write.ts"]);
    expect([...merged.edited]).toEqual(["prior-edit.ts", "current-edit.ts"]);
  });

  test("strips the marker from every prompt-bearing field without destroying the request", () => {
    const sentinelItem = { role: "user", content: [{ type: "input_text", text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${REMOTE_COMPACTION_SUMMARY_SENTINEL}\n</summary>` }] };
    const stripped = stripRemoteCompactionMarker({
      model: "other",
      input: [sentinelItem, { role: "user", content: [{ type: "input_text", text: "keep me" }] }],
      messages: [{ content: [{ type: "text", text: sentinelItem.content[0].text }] }, { content: "keep me too" }],
      contents: [{ content: sentinelItem.content[0].text }],
    });

    // The un-replayable marker is removed, but the real prompt survives and the
    // request stays valid (a poisoned payload would break every later turn).
    expect(JSON.stringify(stripped)).not.toContain(REMOTE_COMPACTION_SUMMARY_SENTINEL);
    expect(stripped).toMatchObject({ model: "other" });
    expect((stripped as any).input).toHaveLength(1);
    expect(JSON.stringify(stripped)).toContain("keep me");
    expect(JSON.stringify(stripped)).toContain("keep me too");
    expect(stripRemoteCompactionMarker("primitive")).toBe("primitive");
  });

  test("cross-model replay drops the marker and still sends a usable request", () => {
    const persisted = details();
    expect(isRemoteCompactionCompatible(model(), persisted)).toBe(true);
    const replay = injectRemoteCompactionPayload(
      { model: "other", input: [{ role: "user", content: [{ type: "input_text", text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${REMOTE_COMPACTION_SUMMARY_SENTINEL}\n</summary>` }] }, { role: "user", content: [{ type: "input_text", text: "current prompt" }] }] },
      model({ id: "other" }),
      persisted,
    );
    expect(replay).toMatchObject({ ok: false, code: "incompatible" });
    if (!replay.ok) {
      // Regression: the fallback must keep a real model id, otherwise every
      // request in the session fails with provider 400 model_not_supported.
      expect(replay.fallbackPayload).toMatchObject({ model: "other" });
      expect(JSON.stringify(replay.fallbackPayload)).not.toContain(REMOTE_COMPACTION_SUMMARY_SENTINEL);
      expect(JSON.stringify(replay.fallbackPayload)).toContain("current prompt");
    }
  });

  test("rejects unverified replay endpoints even when persisted metadata matches the active model", () => {
    const proxyDetails = details({ baseUrl: "https://proxy.example/v1" });
    expect(isRemoteCompactionCompatible(model({ baseUrl: "https://proxy.example/v1" }), proxyDetails)).toBe(false);
  });

  test("rejects truncated or unrecognized opaque details", () => {
    expect(parseRemoteCompactionDetails({ ...details(), output: [] })).toBeNull();
    expect(parseRemoteCompactionDetails({ ...details(), fileOperations: undefined })).toBeNull();
    expect(parseRemoteCompactionDetails({ ...details(), version: 2 })).toBeNull();
    expect(parseRemoteCompactionDetails({ ...details(), output: [{ type: "compaction", encrypted_content: "" }] })).toBeNull();
  });
});
