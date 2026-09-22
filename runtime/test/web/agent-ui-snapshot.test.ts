import { afterEach, expect, test } from "bun:test";
import {
  getAgentUiSnapshot,
  invalidateAgentUiSnapshot,
} from "../../web/src/ui/agent-ui-snapshot";
import {
  getAgentStatus,
  getAgentContext,
  getAgentModelState,
} from "../../web/src/api";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const payload = (model = "fixture/one") => ({
  status: { status: "idle" },
  model: { current: model },
  context: { tokens: 12 },
  metrics: { cpu_percent: 1 },
  agent_name: "Fixture",
  errors: [],
});
test("Classic status/context/model consumers share one request and reply with Visual transport", async () => {
  const jid = "web:coalesce";
  let calls = 0;
  globalThis.fetch = (async (input) => {
    calls++;
    expect(String(input)).toBe("/agent/status?chat_jid=web%3Acoalesce&ui=1");
    await Promise.resolve();
    return Response.json(payload());
  }) as typeof fetch;
  const [a, b, c, d] = await Promise.all([
    getAgentStatus(jid),
    getAgentContext(jid),
    getAgentModelState(jid),
    getAgentUiSnapshot(jid),
  ]);
  expect(calls).toBe(1);
  expect(a).toBe(d.status);
  expect(b).toBe(d.context);
  expect(c).toBe(d.model);
  expect(await getAgentUiSnapshot(jid)).toBe(d);
  expect(calls).toBe(1);
  invalidateAgentUiSnapshot(jid);
  const next = await getAgentUiSnapshot(jid);
  expect(calls).toBe(2);
  expect(next.status).toBe(d.status);
  expect(next.context).toBe(d.context);
});
test("chat isolation and invalidation while parsing a body discard the stale reply for all joiners", async () => {
  let release!: () => void;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1)
      return {
        ok: true,
        json: () =>
          new Promise((resolve) => {
            release = () => resolve(payload("fixture/old"));
          }),
      } as Response;
    return Response.json(payload("fixture/new"));
  }) as typeof fetch;
  const first = getAgentUiSnapshot("web:race");
  await Promise.resolve();
  await Promise.resolve();
  const joined = getAgentUiSnapshot("web:race");
  expect(first).toBe(joined);
  invalidateAgentUiSnapshot("web:race");
  release();
  const [a, b] = await Promise.all([first, joined]);
  expect(a).toBe(b);
  expect(a.model.current).toBe("fixture/new");
  expect(calls).toBe(2);
  await getAgentUiSnapshot("web:other");
  expect(calls).toBe(3);
});
for (const status of [401, 403, 500])
  test(`failed HTTP${status} is never cached`, async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1
        ? new Response(null, { status })
        : Response.json(payload());
    }) as typeof fetch;
    await expect(getAgentUiSnapshot("web:failed" + status)).rejects.toThrow(
      `HTTP ${status}`,
    );
    expect(
      (await getAgentUiSnapshot("web:failed" + status)).model.current,
    ).toBe("fixture/one");
    expect(calls).toBe(2);
  });
test("partial snapshot lets healthy consumers work but failing sections are not fabricated", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      ...payload(),
      context: null,
      errors: ["context"],
    })) as typeof fetch;
  const jid = "web:partial";
  expect((await getAgentStatus(jid)).status).toBe("idle");
  await expect(getAgentContext(jid)).rejects.toThrow("Context unavailable");
});

test("snapshot module imports with a partial non-browser window", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "http://fixture/" } } });
    const { importFresh } = await import("../helpers");
    const module = await importFresh("../../web/src/ui/agent-ui-snapshot.ts", import.meta.url);
    expect(typeof module.getAgentUiSnapshot).toBe("function");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
