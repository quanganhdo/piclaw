import { afterEach, expect, test } from "bun:test";
import { FamilyRealtime } from "../../web/src/family-realtime.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) } as MessageEvent);
  }
  close() { this.closed = true; }
}

const originalEventSource = globalThis.EventSource;
afterEach(() => {
  globalThis.EventSource = originalEventSource;
  FakeEventSource.instances = [];
});

function fixture() {
  globalThis.EventSource = FakeEventSource as any;
  const changed: any[] = [], posts: any[] = [], invalidations: string[] = [];
  const realtime = new FamilyRealtime({
    sseUrl: chat => `/sse/stream?chat_jid=${encodeURIComponent(chat)}`,
    getStatus: async chat => ({ status: "idle", chat_jid: chat, data: null }),
    getContext: async () => ({}), refreshTimeline: () => {}, refreshQueue: () => {}, refreshDirectory: () => {},
    setPosts: next => posts.push(next), setContextUsage: () => {}, applyModelState: () => {},
    changed: snapshot => changed.push(structuredClone(snapshot)), invalidated: () => invalidations.push("invalid"), revalidate: async () => {},
  });
  return { realtime, changed, posts, invalidations };
}

test("family realtime feeds the shared reducer and fences prior conversation events", () => {
  const { realtime, invalidations } = fixture();
  realtime.start("web:one"); const first = FakeEventSource.instances.at(-1)!;
  first.emit("agent_status", { chat_jid: "web:one", type: "thinking", title: "one", turn_id: "turn-one" });
  expect(realtime.snapshot()).toMatchObject({ agentStatus: { title: "one" }, currentTurnId: "turn-one" });

  realtime.start("web:two"); const second = FakeEventSource.instances.at(-1)!;
  expect(first.closed).toBe(true);
  first.emit("agent_status", { chat_jid: "web:one", type: "thinking", title: "late" });
  expect(realtime.snapshot().agentStatus).toBeNull();
  second.emit("agent_status", { chat_jid: "web:two", type: "thinking", title: "two", turn_id: "turn-two" });
  expect(realtime.snapshot()).toMatchObject({ agentStatus: { title: "two" }, currentTurnId: "turn-two" });
  second.emit("agent_status", { chat_jid: "web:one", type: "thinking", title: "foreign" });
  expect(invalidations).toEqual(["invalid"]);
});

test("family realtime rejects a stale snapshot after a live queue event", () => {
  const { realtime } = fixture();
  realtime.start("web:one"); const source = FakeEventSource.instances.at(-1)!;
  const revision = realtime.revision();
  source.emit("agent_followup_queued", { chat_jid: "web:one", row_id: 7, content: "queued", timestamp: "now" });
  expect(realtime.snapshot().queueItems).toMatchObject([{ row_id: 7, content: "queued" }]);
  realtime.applyServerSnapshot({ status: "idle", data: null }, [], revision);
  expect(realtime.snapshot().queueItems).toHaveLength(1);
});
