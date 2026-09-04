/**
 * test/channels/web/web-sse-client.test.ts – Tests for the browser-side SSEClient.
 *
 * Verifies reconnection scheduling, cooldown enforcement, and
 * event dispatch in the frontend SSE client class.
 */

import { expect, test } from "bun:test";
import "../../helpers.js";

import { SSEClient, streamSidePrompt } from "../../../web/src/api.ts";

test("SSEClient scheduleReconnect triggers cooldown", () => {
  const client = new SSEClient(() => {}, () => {});

  const originalSetTimeout = globalThis.setTimeout;
  const originalNow = Date.now;
  let scheduledDelay = 0;

  globalThis.setTimeout = ((_, delay) => {
    scheduledDelay = Number(delay);
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  Date.now = () => 1000;

  client.reconnectAttempts = 10;
  client.scheduleReconnect();

  expect(client.cooldownUntil).toBe(61000);
  expect(scheduledDelay).toBe(60000);

  globalThis.setTimeout = originalSetTimeout;
  Date.now = originalNow;
});

test("SSEClient reconnectIfNeeded respects cooldown", () => {
  const client = new SSEClient(() => {}, () => {});
  let connected = false;
  client.connect = () => {
    connected = true;
  };

  client.status = "disconnected";
  client.cooldownUntil = Date.now() + 10000;
  client.reconnectIfNeeded();

  expect(connected).toBe(false);
});

test("SSEClient connects to a chat-scoped SSE stream when chatJid is provided", () => {
  const OriginalEventSource = globalThis.EventSource;
  const opened: string[] = [];

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(url: string) {
      opened.push(url);
    }
    addEventListener() {}
    close() {}
  }

  globalThis.EventSource = FakeEventSource as any;
  try {
    const client = new SSEClient(() => {}, () => {}, { chatJid: "web:branch-a" });
    client.connect();
    expect(opened[0]).toBe("/sse/stream?chat_jid=web%3Abranch-a");
  } finally {
    globalThis.EventSource = OriginalEventSource;
  }
});

test("SSEClient preserves connected payload for asset-version reconciliation", () => {
  const OriginalEventSource = globalThis.EventSource;
  let source: FakeEventSource | null = null;
  const events: Array<{ type: string; data: unknown }> = [];

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners = new Map<string, Array<(event: { data: string }) => void>>();
    constructor(_url: string) { source = this; }
    addEventListener(event: string, listener: (event: { data: string }) => void) {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
    }
    emit(event: string, data: unknown) {
      for (const listener of this.listeners.get(event) ?? []) listener({ data: JSON.stringify(data) });
    }
    close() {}
  }

  globalThis.EventSource = FakeEventSource as any;
  try {
    const client = new SSEClient((type, data) => events.push({ type, data }), () => {});
    client.connect();
    source!.emit("connected", { app_asset_version: "next-build", chat_jid: "web:default" });
    expect(events).toEqual([{
      type: "connected",
      data: { app_asset_version: "next-build", chat_jid: "web:default" },
    }]);
    client.disconnect();
  } finally {
    globalThis.EventSource = OriginalEventSource;
  }
});

test("SSEClient disposal fences delayed stale callbacks across an A-to-B-to-A remount", () => {
  const OriginalEventSource = globalThis.EventSource;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const instances: FakeEventSource[] = [];
  const timers = new Map<number, () => void>();
  let timerSerial = 0;

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners = new Map<string, Array<(event: { data: string }) => void>>();
    closed = false;
    constructor(readonly url: string) {
      instances.push(this);
    }
    addEventListener(event: string, listener: (event: { data: string }) => void) {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
    }
    emit(event: string, data: unknown = {}) {
      for (const listener of this.listeners.get(event) ?? []) listener({ data: JSON.stringify(data) });
    }
    close() {
      this.closed = true;
    }
  }

  globalThis.EventSource = FakeEventSource as any;
  globalThis.setTimeout = ((callback: () => void) => {
    const id = ++timerSerial;
    timers.set(id, callback);
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    timers.delete(Number(id));
  }) as typeof clearTimeout;

  try {
    const applied: Array<{ type: string; data: unknown }> = [];
    const collect = (type: string, data: unknown) => applied.push({ type, data });

    const firstA = new SSEClient(collect, () => {}, { chatJid: "web:a" });
    firstA.connect();
    const staleA = instances[0];
    const delayedError = staleA.onerror!;
    staleA.onopen?.();
    firstA.disconnect();

    const mountB = new SSEClient(collect, () => {}, { chatJid: "web:b" });
    mountB.connect();
    mountB.disconnect();

    const currentA = new SSEClient(collect, () => {}, { chatJid: "web:a" });
    currentA.connect();
    const authoritativeA = instances[2];
    authoritativeA.onopen?.();

    delayedError();
    for (const callback of [...timers.values()]) callback();

    staleA.emit("agent_status", { operation_id: "stale" });
    authoritativeA.emit("agent_status", { operation_id: "current" });
    for (const source of instances.slice(3)) source.emit("agent_status", { operation_id: "resurrected" });

    expect(instances.map(source => source.url)).toEqual([
      "/sse/stream?chat_jid=web%3Aa",
      "/sse/stream?chat_jid=web%3Ab",
      "/sse/stream?chat_jid=web%3Aa",
    ]);
    expect(timers.size).toBe(0);
    expect(applied).toEqual([{ type: "agent_status", data: { operation_id: "current" } }]);
    currentA.disconnect();
  } finally {
    globalThis.EventSource = OriginalEventSource;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("SSEClient current-source errors reconnect once and ignore later callbacks from the failed source", () => {
  const OriginalEventSource = globalThis.EventSource;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const instances: FakeEventSource[] = [];
  const timers = new Map<number, () => void>();
  let timerSerial = 0;

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners = new Map<string, Array<(event: { data: string }) => void>>();
    closeCalls = 0;
    constructor(_url: string) {
      instances.push(this);
    }
    addEventListener(event: string, listener: (event: { data: string }) => void) {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
    }
    emit(event: string, data: unknown = {}) {
      for (const listener of this.listeners.get(event) ?? []) listener({ data: JSON.stringify(data) });
    }
    close() {
      this.closeCalls += 1;
    }
  }

  globalThis.EventSource = FakeEventSource as any;
  globalThis.setTimeout = ((callback: () => void) => {
    const id = ++timerSerial;
    timers.set(id, callback);
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    timers.delete(Number(id));
  }) as typeof clearTimeout;

  try {
    const statuses: string[] = [];
    const applied: string[] = [];
    const client = new SSEClient((type) => applied.push(type), status => statuses.push(status), { chatJid: "web:a" });
    client.connect();
    const failed = instances[0];
    failed.onopen?.();
    failed.onerror?.();
    failed.onerror?.();

    expect(failed.closeCalls).toBe(1);
    expect(statuses).toEqual(["connected", "disconnected"]);
    expect(client.reconnectAttempts).toBe(1);
    expect(timers.size).toBe(1);

    for (const callback of [...timers.values()]) callback();
    const replacement = instances[1];
    replacement.onopen?.();
    failed.emit("agent_status", {});
    replacement.emit("agent_status", {});

    expect(instances).toHaveLength(2);
    expect(applied).toEqual(["agent_status"]);
    client.disconnect();
  } finally {
    globalThis.EventSource = OriginalEventSource;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("SSEClient disconnect invalidates a reconnect callback that was already queued", () => {
  const OriginalEventSource = globalThis.EventSource;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const instances: FakeEventSource[] = [];
  let queuedReconnect: (() => void) | null = null;

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) {
      instances.push(this);
    }
    addEventListener() {}
    close() {}
  }

  globalThis.EventSource = FakeEventSource as any;
  globalThis.setTimeout = ((callback: () => void) => {
    queuedReconnect = callback;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const client = new SSEClient(() => {}, () => {});
    client.connect();
    instances[0].onerror?.();
    expect(queuedReconnect).not.toBeNull();
    client.disconnect();
    (queuedReconnect as unknown as () => void)();
    client.connect();
    client.reconnectIfNeeded();
    client.forceReconnect();
    expect(instances).toHaveLength(1);
  } finally {
    globalThis.EventSource = OriginalEventSource;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("SSEClient ignores a replaced reconnect timer from the same connection generation", () => {
  const OriginalEventSource = globalThis.EventSource;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const instances: FakeEventSource[] = [];
  const queued: Array<() => void> = [];

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) {
      instances.push(this);
    }
    addEventListener() {}
    close() {}
  }

  globalThis.EventSource = FakeEventSource as any;
  globalThis.setTimeout = ((callback: () => void) => {
    queued.push(callback);
    return queued.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const client = new SSEClient(() => {}, () => {});
    client.scheduleReconnect();
    client.scheduleReconnect();
    queued[0]();
    expect(instances).toHaveLength(0);
    queued[1]();
    expect(instances).toHaveLength(1);
    client.disconnect();
  } finally {
    globalThis.EventSource = OriginalEventSource;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("SSEClient forced reconnect fences the replaced source and opens one successor", () => {
  const OriginalEventSource = globalThis.EventSource;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const instances: FakeEventSource[] = [];
  let reconnect: (() => void) | null = null;

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    listeners = new Map<string, Array<(event: { data: string }) => void>>();
    closeCalls = 0;
    constructor(_url: string) {
      instances.push(this);
    }
    addEventListener(event: string, listener: (event: { data: string }) => void) {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
    }
    emit(event: string, data: unknown = {}) {
      for (const listener of this.listeners.get(event) ?? []) listener({ data: JSON.stringify(data) });
    }
    close() {
      this.closeCalls += 1;
    }
  }

  globalThis.EventSource = FakeEventSource as any;
  globalThis.setTimeout = ((callback: () => void) => {
    reconnect = callback;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const statuses: string[] = [];
    const applied: string[] = [];
    const client = new SSEClient(type => applied.push(type), status => statuses.push(status));
    client.connect();
    const replaced = instances[0];
    replaced.onopen?.();
    client.forceReconnect();
    replaced.onerror?.();
    (reconnect as unknown as () => void)();
    const successor = instances[1];
    successor.onopen?.();
    replaced.emit("agent_status", {});
    successor.emit("agent_status", {});

    expect(replaced.closeCalls).toBe(1);
    expect(instances).toHaveLength(2);
    expect(statuses).toEqual(["connected", "disconnected", "connected"]);
    expect(applied).toEqual(["agent_status"]);
    client.disconnect();
  } finally {
    globalThis.EventSource = OriginalEventSource;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("SSEClient no longer registers stale agent_request listeners", () => {
  const OriginalEventSource = globalThis.EventSource;
  const seenEvents: string[] = [];

  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) {}
    addEventListener(event: string) {
      seenEvents.push(event);
    }
    close() {}
  }

  globalThis.EventSource = FakeEventSource as any;
  try {
    const client = new SSEClient(() => {}, () => {});
    client.connect();
    expect(seenEvents).not.toContain("agent_request");
    expect(seenEvents).not.toContain("agent_request_timeout");
    expect(seenEvents).toContain("agent_status");
    expect(seenEvents).toContain("new_post");
    expect(seenEvents).toContain("workspace_update");
    expect(seenEvents).toContain("extension_ui_request");
    expect(seenEvents).toContain("extension_ui_notify");
    expect(seenEvents).toContain("extension_ui_error");
  } finally {
    globalThis.EventSource = OriginalEventSource;
  }
});

test("streamSidePrompt parses SSE event frames, returns the final payload, and forwards the active chat_jid", async () => {
  const originalFetch = globalThis.fetch;
  let seenBody: any = null;
  globalThis.fetch = (async (_url, init) => {
    seenBody = init?.body ? JSON.parse(String(init.body)) : null;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: side_prompt_start\ndata: {"chat_jid":"web:branch-a"}\n\n'));
        controller.enqueue(encoder.encode('event: side_prompt_thinking_delta\ndata: {"delta":"plan"}\n\n'));
        controller.enqueue(encoder.encode('event: side_prompt_text_delta\ndata: {"delta":"answer"}\n\n'));
        controller.enqueue(encoder.encode('event: side_prompt_done\ndata: {"status":"success","result":"answer","thinking":"plan","model":"openai/gpt-test"}\n\n'));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;

  const seen: Array<string> = [];
  const result = await streamSidePrompt("What changed?", {
    chatJid: "web:branch-a",
    onThinkingDelta: (delta) => seen.push(`thinking:${delta}`),
    onTextDelta: (delta) => seen.push(`text:${delta}`),
  });

  expect(seenBody).toEqual({
    prompt: "What changed?",
    chat_jid: "web:branch-a",
  });
  expect(seen).toEqual(["thinking:plan", "text:answer"]);
  expect(result).toEqual({
    status: "success",
    result: "answer",
    thinking: "plan",
    model: "openai/gpt-test",
  });

  globalThis.fetch = originalFetch;
});
