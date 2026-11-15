import { expect, test } from "bun:test";
import { AgentPool } from "../../src/agent-pool.js";
import type { DurableSessionPositionPort } from "../../src/agent-pool/durable-runtime-adapter.js";

const forbidden = () => { throw Error("Metadata must not execute a control, derive context or hydrate legacy state"); };
// Exercise the read-only facade without constructing the process-wide agent runtime.
function fixture(position: DurableSessionPositionPort | undefined, durable = true) {
  const pool = Object.create(AgentPool.prototype) as AgentPool;
  let lookups = 0;
  Object.assign(pool, { durableApplication: durable ? {} : undefined, durableSessionLookup: (chat: string) => {
    expect(chat).toBe("web:owned"); lookups++; return position;
  }, getSessionForIntrospection: forbidden });
  return { pool, lookups: () => lookups };
}

test("durable metadata uses capabilities of the same captured native position", async () => {
  let reads = 0;
  const position = { sessionId: "fixture", branchId: "fixture", readPosition: forbidden,
    readModel: forbidden, setModel: forbidden, readReport: forbidden,
    readMetadata: async () => { reads++; return { backend: "durable", conversationId: "fixture", extensions: [], tools: [], commandCatalogue: [{ name: "/fork", status: "native" }] }; },
  } as unknown as DurableSessionPositionPort;
  const f = fixture(position);
  const metadata = await f.pool.getDurableSessionMetadata("web:owned") as any;
  expect(f.lookups()).toBe(1); expect(reads).toBe(1);
  expect(metadata.backend).toBe("durable");
  expect(metadata.commandCatalogue.find((c: any) => c.name === "/model").status).toBe("native");
  expect(metadata.commandCatalogue.find((c: any) => c.name === "/fork").status).toBe("unavailable");
  expect(metadata.commandCatalogue.find((c: any) => c.name === "/thinking").status).toBe("unavailable");
  expect(metadata.commandCatalogue.find((c: any) => c.name === "/context").aliases).toContain("/ctx");
});

test("non-durable metadata preserves the legacy discriminator", async () => {
  const f = fixture(undefined, false);
  expect(await f.pool.getDurableSessionMetadata("web:owned")).toBeUndefined();
  expect(f.lookups()).toBe(0);
});

for (const [label, position] of [
  ["missing position", undefined],
  ["missing reader", { sessionId: "fixture", branchId: "fixture", readPosition: forbidden }],
  ["null metadata", { sessionId: "fixture", branchId: "fixture", readPosition: forbidden, readMetadata: async () => null }],
  ["undefined metadata", { sessionId: "fixture", branchId: "fixture", readPosition: forbidden, readMetadata: async () => undefined }],
] as const) test(label + ": native metadata cannot fall through to legacy hydration", async () => {
  const { pool } = fixture(position as unknown as DurableSessionPositionPort | undefined);
  expect(await pool.getDurableSessionMetadata("web:owned")).toBeNull();
});
