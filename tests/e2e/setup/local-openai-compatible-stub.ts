/**
 * Deterministic OpenAI-compatible model stub for the E2E UX suite.
 *
 * The browser tests exercise PiClaw's UI contracts. They need a reachable
 * chat-completions provider, but they must not depend on external free-tier
 * model availability, provider quotas, or product-specific auth rules.
 *
 * Supported endpoints:
 *   GET  /models and /v1/models
 *   POST /chat/completions and /v1/chat/completions
 */

const port = Number.parseInt(process.env.PICLAW_E2E_LLM_STUB_PORT || "34567", 10);
const host = process.env.PICLAW_E2E_LLM_STUB_HOST || "127.0.0.1";
const model = process.env.PICLAW_E2E_LLM_STUB_MODEL || "piclaw-e2e-stub";
const alternateModel = process.env.PICLAW_E2E_LLM_STUB_ALT_MODEL || "piclaw-e2e-stub-alt";

const encoder = new TextEncoder();
// Disposable loopback-only controls. Never enabled for an externally bound stub.
const controlledRequests = new Map<string, { started: boolean; completed: boolean; release: () => void; wait: Promise<void> }>();
let nextControl: string | null = null;
function armControl(id: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(id) || nextControl || controlledRequests.size >= 64) return false;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  controlledRequests.set(id, { started: false, completed: false, release, wait });
  nextControl = id;
  return true;
}

type ChatMessage = { role?: string; content?: unknown };
type ChatCompletionRequest = {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const value = (part as { text?: unknown; content?: unknown }).text ?? (part as { text?: unknown; content?: unknown }).content;
    return typeof value === "string" ? value : "";
  }).join(" ");
}

function latestUserPrompt(messages: ChatMessage[] = []): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return textFromContent(messages[i]?.content);
  }
  return "";
}

function tokenEstimate(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function replyFor(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("compact") || lower.includes("summar")) {
    return '## Goal\nRetain the known software-testing conversation and its fixed response.\n\n## Current Active Topic\n- Deterministic browser qualification.\n\n## Historical / Background Context\n- The user supplied short known context; the assistant returned a fixed answer.\n\n## Constraints & Preferences\n- No external services or file changes.\n\n## Progress\n### Done\n- [x] Answered the known request.\n### In Progress\n- [ ] Continue browser qualification.\n### Blocked\n- None.\n\n## Key Decisions\n- Preserve the known request and response.\n\n## Next Steps\n1. Continue the next test turn.\n\n## Critical Context\n- The local deterministic provider supplies all responses; no real account or billable inference is used.';
  }
  if (lower.includes("500-word") || lower.includes("quantum computing") || lower.includes("global economy")) {
    return [
      "Deterministic long-running E2E response.",
      "This paragraph is deliberately streamed in several chunks so the compose queue, abort button, reconnect handling, and context meter can observe an active agent turn without relying on an external model.",
      "The content is stable, short enough for CI, and long enough for the UI to notice that work is in progress.",
      "Testing remains a craft of patient evidence: create a known input, produce a known output, and leave the network out of the argument.",
    ].join(" ");
  }
  if (lower.includes("hello")) return "Hello from the deterministic PiClaw E2E model stub.";
  if (lower.includes("model")) return "The active model is the deterministic PiClaw E2E stub.";
  return "Deterministic PiClaw E2E response: the local model stub received the request and returned a stable assistant message.";
}

function completionUsage(prompt: string, content: string) {
  const promptTokens = tokenEstimate(prompt) + 32;
  const completionTokens = tokenEstimate(content);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function chunk(content: string, finishReason: string | null = null, usage?: ReturnType<typeof completionUsage>, selectedModel = model) {
  return {
    id: "chatcmpl-piclaw-e2e-stub",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: selectedModel,
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
}

function splitForStreaming(content: string): string[] {
  const words = content.split(/(\s+)/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    current += word;
    if (current.length >= 36) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [content];
}

async function sleep(ms: number) {
  if (ms > 0) await Bun.sleep(ms);
}

function streamCompletion(request: ChatCompletionRequest, prompt: string, content: string, usage: ReturnType<typeof completionUsage>) {
  const chunks = splitForStreaming(content);
  const longTurn = /500-word|quantum computing|global economy/i.test(prompt);
  const perChunkDelay = longTurn ? 220 : 25;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...chunk("", null, undefined, request.model || model), choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`));
        for (const piece of chunks) {
          if (cancelled) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk(piece, null, undefined, request.model || model))}\n\n`));
          await sleep(perChunkDelay);
        }
        if (cancelled) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk("", "stop", usage, request.model || model))}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        try { controller.error(error); } catch { /* already closed */ }
      }
    },
    cancel() { cancelled = true; },
  });
}

async function handleChatCompletion(request: Request) {
  let body: ChatCompletionRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const controlId = nextControl;
  nextControl = null;
  const control = controlId ? controlledRequests.get(controlId) : undefined;
  if (control) {
    console.log(JSON.stringify({ event: 'fixture_request_held', id: controlId }));
    control.started = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([control.wait, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture control deadline')), 30_000); })]);
    } catch {
      return json({ error: { message: 'Fixture control deadline' } }, { status: 504 });
    } finally { clearTimeout(timer); }
  }
  const prompt = latestUserPrompt(body.messages);
  const marker = /\[e2e-id:([a-z0-9-]+)\]/.exec(prompt)?.[1];
  const summaryRequest = (body.messages || []).some(message => message.role === 'system' && /structured checkpoint|conversation summar|## Goal/i.test(textFromContent(message.content)));
  const content = summaryRequest ? replyFor('summarize') : marker ? `E2E response ${marker}. ${replyFor(prompt)}` : replyFor(prompt);
  if (control) control.completed = true;
  const usage = completionUsage(prompt, content);
  const selectedModel = body.model || model;

  if (body.stream) {
    return new Response(streamCompletion(body, prompt, content, usage), {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  return json({
    id: "chatcmpl-piclaw-e2e-stub",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: selectedModel,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage,
  });
}

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (process.env.PICLAW_E2E_DISPOSABLE === '1' && (host === '127.0.0.1' || host === '::1') && url.pathname === '/__test/control') {
      if (request.method === 'POST') {
        const body = await request.json() as { action?: string; id?: string };
        const id = String(body.id || '');
        if (!['hold', 'release', 'clear'].includes(String(body.action)) || (body.action !== 'clear' && !/^[a-z0-9-]{1,80}$/.test(id))) return json({ error: 'invalid fixture control' }, { status: 400 });
        console.log(JSON.stringify({ event: 'fixture_control', action: body.action, id: body.action === 'clear' ? '' : id }));
        if (body.action === 'hold') return json({ ok: armControl(id) });
        if (body.action === 'release') {
          const control = controlledRequests.get(id);
          if (control) { control.release(); if (nextControl === id) nextControl = null; }
          return json({ ok: !!control });
        }
        if (body.action === 'clear') { for (const c of controlledRequests.values()) c.release(); controlledRequests.clear(); nextControl = null; return json({ ok: true }); }
        return json({ error: 'invalid fixture action' }, { status: 400 });
      }
      if (request.method === 'GET') { const c = controlledRequests.get(url.searchParams.get('id') || ''); return json({ started: c?.started || false, completed: c?.completed || false }); }
    }
    if (request.method === "GET" && (url.pathname === "/models" || url.pathname === "/v1/models")) {
      return json({
        object: "list",
        data: [model, alternateModel].map((id) => ({ id, object: "model", created: 0, owned_by: "piclaw-e2e" })),
      });
    }
    if (request.method === "POST" && (url.pathname === "/chat/completions" || url.pathname === "/v1/chat/completions")) {
      return handleChatCompletion(request);
    }
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
    return json({ error: { message: "not found" } }, { status: 404 });
  },
});

console.log(`PiClaw E2E OpenAI-compatible stub listening on http://${host}:${server.port}/v1`);
