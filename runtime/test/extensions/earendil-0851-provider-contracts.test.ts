import { describe, expect, test } from "bun:test";
import type { Context, Model } from "@earendil-works/pi-ai";
import * as openaiCodexResponsesApi from "@earendil-works/pi-ai/api/openai-codex-responses";
import * as openaiResponsesApi from "@earendil-works/pi-ai/api/openai-responses";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

import { sanitizeProviderPayloadItemIds } from "../../src/extensions/provider-request-sanitizer.js";

type Payload = Record<string, unknown>;

const context: Context = {
  messages: [{ role: "user", content: "offline provider contract", timestamp: 1 }],
};

const completedResponse = {
  type: "response.completed",
  response: {
    id: "resp_offline",
    status: "completed",
    output: [],
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  },
};

function sseResponse(event: unknown, trailingFrameBoundary = true): Response {
  return new Response(`data: ${JSON.stringify(event)}${trailingFrameBoundary ? "\n\n" : ""}`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function requireOpenAIModel(id: string): Model<"openai-responses"> {
  const model = getBuiltinModels("openai").find((candidate) => candidate.id === id);
  expect(model, `missing OpenAI ${id} from the 0.85.1 public catalog`).toBeDefined();
  return model as Model<"openai-responses">;
}

async function captureResponsesPayload(
  model: Model<"openai-responses">,
  cacheRetention: "none" | "short" | "long",
): Promise<{ sanitized: Payload; sent: Payload }> {
  let sanitized: Payload | undefined;
  let sent: Payload | undefined;
  let fetchCalls = 0;

  const responseStream = openaiResponsesApi.stream(model, context, {
    apiKey: "offline-test-key",
    cacheRetention,
    sessionId: "offline-session",
    onPayload: (payload) => {
      sanitized = sanitizeProviderPayloadItemIds(payload) as Payload;
      return sanitized;
    },
    fetch: async (input, init) => {
      fetchCalls += 1;
      const request = input instanceof Request ? input : new Request(input, init);
      sent = await request.clone().json() as Payload;
      return sseResponse(completedResponse);
    },
  });

  const events: string[] = [];
  for await (const event of responseStream) events.push(event.type);

  expect(events.at(-1)).toBe("done");
  expect(fetchCalls).toBe(1);
  expect(sanitized).toBeDefined();
  expect(sent).toBeDefined();
  if (!sanitized || !sent) throw new Error("provider payload capture did not run");
  expect(sent).toEqual(JSON.parse(JSON.stringify(sanitized)));
  return { sanitized, sent };
}

describe("Earendil 0.85.1 offline provider contracts", () => {
  test("GPT-5.6+ long retention uses explicit 30m prompt-cache options in the sanitized wire payload", async () => {
    expect(typeof openaiResponsesApi.stream).toBe("function");
    for (const id of ["gpt-5.6-sol", "gpt-6-astra"]) {
      const model = requireOpenAIModel(id);
      expect(model.compat?.supportsExplicitPromptCacheMode, id).toBe(true);

      const { sanitized, sent } = await captureResponsesPayload(model, "long");
      for (const payload of [sanitized, sent]) {
        expect(payload.prompt_cache_options, id).toEqual({ ttl: "30m" });
        expect(payload.prompt_cache_retention, id).toBeUndefined();
      }
    }
  });

  test("earlier and non-explicit Responses models retain the legacy 24h field", async () => {
    const earlier = requireOpenAIModel("gpt-5.5");
    const gpt56 = requireOpenAIModel("gpt-5.6-sol");
    const other: Model<"openai-responses"> = {
      ...gpt56,
      id: "compatible-gateway-model",
      name: "Compatible gateway model",
      provider: "offline-compatible-gateway",
      baseUrl: "https://offline.invalid/v1",
      compat: {
        ...gpt56.compat,
        supportsExplicitPromptCacheMode: false,
      },
    };

    for (const model of [earlier, other]) {
      const { sent } = await captureResponsesPayload(model, "long");
      expect(sent.prompt_cache_retention, model.id).toBe("24h");
      expect(sent, model.id).not.toHaveProperty("prompt_cache_options");
    }
  });

  test("GPT-5.6 explicit cache mode does not accidentally request long retention for short or disabled caching", async () => {
    const model = requireOpenAIModel("gpt-5.6-sol");
    const short = (await captureResponsesPayload(model, "short")).sent;
    const none = (await captureResponsesPayload(model, "none")).sent;

    expect(short).not.toHaveProperty("prompt_cache_options");
    expect(short).not.toHaveProperty("prompt_cache_retention");
    expect(none.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(none).not.toHaveProperty("prompt_cache_key");
    expect(none).not.toHaveProperty("prompt_cache_retention");
  });

  test("Codex converts an EOF-terminated response.done event into a successful terminal stream", async () => {
    const model = getBuiltinModels("openai-codex").find((candidate) => candidate.id === "gpt-5.6-sol");
    expect(model, "missing Codex GPT-5.6 Sol from the 0.85.1 public catalog").toBeDefined();

    const tokenPayload = btoa(JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "offline-account" },
    }));
    const token = `e30.${tokenPayload}.offline-signature`;
    let fetchCalls = 0;
    const events: string[] = [];
    const responseStream = openaiCodexResponsesApi.stream(
      model as Model<"openai-codex-responses">,
      context,
      {
        apiKey: token,
        transport: "sse",
        fetch: async () => {
          fetchCalls += 1;
          return sseResponse({ ...completedResponse, type: "response.done" }, false);
        },
      },
    );

    for await (const event of responseStream) events.push(event.type);

    expect(fetchCalls).toBe(1);
    expect(events).toEqual(["start", "done"]);
    expect((await responseStream.result()).stopReason).toBe("stop");
  });
});
