import { describe, expect, test } from "bun:test";

import { WebChannelState } from "../../../../src/channels/web/runtime/channel-state.js";

describe("web context usage session generations", () => {
  test("clears usage on a new session generation and rejects stale writes", () => {
    const state = new WebChannelState("test:context-generation");

    state.setContextUsage("web:alpha", {
      tokens: 90_000,
      contextWindow: 100_000,
      percent: 90,
      sessionGeneration: "session-old",
    });
    expect(state.getContextUsage("web:alpha")?.tokens).toBe(90_000);

    state.setContextUsage("web:alpha", {
      tokens: null,
      contextWindow: null,
      percent: null,
      sessionGeneration: "session-new",
      reset: true,
    });
    expect(state.getContextUsage("web:alpha")).toEqual({
      tokens: null,
      contextWindow: null,
      percent: null,
      sessionGeneration: "session-new",
    });

    state.setContextUsage("web:alpha", {
      tokens: 95_000,
      contextWindow: 100_000,
      percent: 95,
      sessionGeneration: "session-old",
    });
    expect(state.getContextUsage("web:alpha")?.sessionGeneration).toBe("session-new");
    expect(state.getContextUsage("web:alpha")?.tokens).toBeNull();
  });

  test("keeps generations isolated per chat", () => {
    const state = new WebChannelState("test:context-generation-isolation");
    state.setContextUsage("web:alpha", {
      tokens: 10,
      contextWindow: 100,
      percent: 10,
      sessionGeneration: "alpha-1",
    });
    state.setContextUsage("web:beta", {
      tokens: 80,
      contextWindow: 100,
      percent: 80,
      sessionGeneration: "beta-1",
    });

    state.setContextUsage("web:alpha", {
      tokens: null,
      contextWindow: null,
      percent: null,
      sessionGeneration: "alpha-2",
      reset: true,
    });

    expect(state.getContextUsage("web:alpha")?.tokens).toBeNull();
    expect(state.getContextUsage("web:beta")?.tokens).toBe(80);
  });
});
