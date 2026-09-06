import { expect, test } from "bun:test";

import { createRunToolCeilingController, type SessionWithToolControl } from "../../src/agent-pool/run-tool-ceiling.js";
import { withExecutionIdentity, type ExecutionIdentity } from '../../src/core/execution-context.js';
import { FAMILY_WEB_TOOLS } from '../../src/core/family-workspace-policy.js';

function createToolSession(initial: string[]) {
  let activeTools = [...initial];
  const calls: string[][] = [];
  const session: SessionWithToolControl = {
    getActiveToolNames: () => [...activeTools],
    setActiveToolsByName: (names) => {
      activeTools = [...names];
      calls.push([...names]);
    },
  };
  return { session, calls, active: () => [...activeTools] };
}

test("run tool ceiling blocks reactivation and restores the owner", () => {
  const owner = createToolSession(["read", "bash", "write"]);
  const originalSetter = owner.session.setActiveToolsByName;
  const ceiling = createRunToolCeilingController({
    chatJid: "web:test",
    runOptions: { toolCeilingFilter: (name) => name === "read" },
  });

  expect(ceiling.apply(owner.session)).toBe(true);
  expect(owner.active()).toEqual(["read"]);
  owner.session.setActiveToolsByName?.(["bash", "read"]);
  expect(owner.active()).toEqual(["read"]);

  ceiling.release();
  expect(owner.session.setActiveToolsByName).toBe(originalSetter);
  expect(owner.active()).toEqual(["read", "bash", "write"]);
  expect(ceiling.getOwner()).toBeNull();
});

test("run tool ceiling transfers ownership without restoring an old setter onto the replacement", () => {
  const oldOwner = createToolSession(["read", "bash"]);
  const replacement = createToolSession(["read", "bash", "write"]);
  const oldSetter = oldOwner.session.setActiveToolsByName;
  const replacementSetter = replacement.session.setActiveToolsByName;
  const ceiling = createRunToolCeilingController({
    chatJid: "dream:test",
    runOptions: { toolCeilingFilter: (name) => name === "read" },
  });

  ceiling.apply(oldOwner.session);
  expect(oldOwner.active()).toEqual(["read"]);

  ceiling.apply(replacement.session);
  expect(oldOwner.session.setActiveToolsByName).toBe(oldSetter);
  expect(oldOwner.active()).toEqual(["read", "bash"]);
  expect(replacement.active()).toEqual(["read"]);
  expect(replacement.session.setActiveToolsByName).not.toBe(oldSetter);

  ceiling.release();
  expect(replacement.session.setActiveToolsByName).toBe(replacementSetter);
  expect(replacement.active()).toEqual(["read", "bash", "write"]);
});

test("run tool ceiling transfers to a replacement when the disposed owner cannot restore", () => {
  let disposed = false;
  const warnings: Array<Record<string, unknown>> = [];
  let oldTools = ["read", "bash"];
  const oldOwner: SessionWithToolControl = {
    getActiveToolNames: () => [...oldTools],
    setActiveToolsByName(names) {
      if (disposed) throw new Error("disposed session");
      oldTools = [...names];
    },
  };
  const replacement = createToolSession(["read", "bash", "write"]);
  const ceiling = createRunToolCeilingController({
    chatJid: "dream:test",
    runOptions: { toolCeilingFilter: (name) => name === "read" },
    onWarn: (_message, details) => warnings.push(details),
  });

  ceiling.apply(oldOwner);
  disposed = true;
  expect(ceiling.apply(replacement.session)).toBe(true);
  expect(replacement.active()).toEqual(["read"]);
  expect(ceiling.getOwner()).toBe(replacement.session);
  expect(warnings).toContainEqual(expect.objectContaining({ operation: "run_agent.tool_ceiling_restore_failed" }));
  ceiling.release();
  expect(replacement.active()).toEqual(["read", "bash", "write"]);
});

test("run tool ceiling rejects owners without complete tool controls", () => {
  const warnings: Array<{ message: string; details: Record<string, unknown> }> = [];
  const ceiling = createRunToolCeilingController({
    chatJid: "web:test",
    runOptions: { toolCeilingFilter: () => true },
    onWarn: (message, details) => warnings.push({ message, details }),
  });

  expect(ceiling.apply({ getActiveToolNames: () => ["read"] })).toBe(false);
  expect(warnings).toEqual([expect.objectContaining({
    details: expect.objectContaining({ operation: "run_agent.tool_ceiling" }),
  })]);
});

test('family ceiling is mandatory, intersects narrower callers and survives reactivation/replacement', () => {
  const identity: ExecutionIdentity = { mode: 'family-shared', username: 'alice', displayName: 'Alice', role: 'admin', rootChatJid: 'web:alice',
    toolPolicy: { revision: 0, allowed: FAMILY_WEB_TOOLS, denied: [] },
    provenance: { kind: 'interactive', actorUserId: 'alice', ownerUserId: 'alice', chatJid: 'web:alice', authenticationSessionId: 'login' } };
  withExecutionIdentity(identity, () => {
    for (const filter of [undefined, () => true, (name: string) => name === 'read']) {
      const owner = createToolSession(['read', 'messages', 'bash', 'keychain', 'unknown-addon']);
      const ceiling = createRunToolCeilingController({ chatJid: 'web:alice', runOptions: { toolCeilingFilter: filter } });
      expect(ceiling.apply(owner.session)).toBe(true);
      const expected = filter?.('messages') === false ? ['read'] : ['read', 'messages'];
      expect(owner.active()).toEqual(expected);
      owner.session.setActiveToolsByName!(['read', 'messages', 'bash', 'unknown-addon']); expect(owner.active()).toEqual(expected);
      const replacement = createToolSession(['write', 'read', 'messages']); ceiling.apply(replacement.session); expect(replacement.active()).toEqual(expected);
      expect(() => ceiling.apply({})).toThrow('requires active-tool controls');
      expect(() => ceiling.apply(null)).toThrow('requires active-tool controls');
      ceiling.release();
    }
    const owner = createToolSession([...FAMILY_WEB_TOOLS, 'shell', 'introspect_sql', 'mcp']);
    const ceiling = createRunToolCeilingController({ chatJid: 'web:alice', runOptions: {} }); ceiling.apply(owner.session);
    expect(owner.active()).toEqual([...FAMILY_WEB_TOOLS]); ceiling.release();
  });
});
