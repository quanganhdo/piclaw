/**
 * test/agent-control/effort-alias.test.ts – Tests for /effort alias and thinking level label logic.
 */

import { describe, expect, test } from "bun:test";
import "../helpers.js";
import {
  resolveThinkingAlias,
  formatThinkingLevelForDisplay,
  usesLegacyMaxThinkingAlias,
} from "../../src/agent-control/agent-control-helpers.js";
import { parseControlCommand } from "../../src/agent-control/index.js";

describe("thinking level alias helpers", () => {
  const legacyMax = { provider: "anthropic", thinkingLevelMap: { xhigh: "max" } } as any;
  const legacyMaxWithExplicitNull = { provider: "anthropic", thinkingLevelMap: { xhigh: "max", max: null } } as any;
  const nativeMax = { provider: "anthropic", thinkingLevelMap: { max: "max" } } as any;
  const nativeBoth = { provider: "anthropic", thinkingLevelMap: { xhigh: "xhigh", max: "max" } } as any;

  test("resolveThinkingAlias only maps legacy xhigh-as-max metadata", () => {
    expect(resolveThinkingAlias("max", legacyMax)).toBe("xhigh");
    expect(resolveThinkingAlias("max", legacyMaxWithExplicitNull)).toBe("xhigh");
    expect(resolveThinkingAlias("max", nativeMax)).toBe("max");
    expect(resolveThinkingAlias("max", nativeBoth)).toBe("max");
    expect(resolveThinkingAlias("high", legacyMax)).toBe("high");
    expect(resolveThinkingAlias("unknown", legacyMax)).toBe("unknown");
    expect(resolveThinkingAlias("max", null)).toBe("max");
  });

  test("formatThinkingLevelForDisplay preserves native xhigh and max", () => {
    expect(formatThinkingLevelForDisplay("xhigh", legacyMax)).toBe("max");
    expect(formatThinkingLevelForDisplay("xhigh", nativeBoth)).toBe("xhigh");
    expect(formatThinkingLevelForDisplay("max", nativeBoth)).toBe("max");
    expect(formatThinkingLevelForDisplay("high", nativeMax)).toBe("high");
    expect(formatThinkingLevelForDisplay("xhigh", null)).toBe("xhigh");
  });

  test("legacy alias detection requires xhigh=max without native max support", () => {
    expect(usesLegacyMaxThinkingAlias(legacyMax)).toBe(true);
    expect(usesLegacyMaxThinkingAlias(legacyMaxWithExplicitNull)).toBe(true);
    expect(usesLegacyMaxThinkingAlias(nativeMax)).toBe(false);
    expect(usesLegacyMaxThinkingAlias(nativeBoth)).toBe(false);
    expect(usesLegacyMaxThinkingAlias(null)).toBe(false);
  });
});

describe("/effort command parsing", () => {
  test("/effort is parsed as a thinking command", () => {
    const cmd = parseControlCommand("/effort high");
    expect(cmd?.type).toBe("thinking");
    expect(cmd && "level" in cmd ? cmd.level : null).toBe("high");
  });

  test("/effort max is parsed as a thinking command with level max", () => {
    const cmd = parseControlCommand("/effort max");
    expect(cmd?.type).toBe("thinking");
    expect(cmd && "level" in cmd ? cmd.level : null).toBe("max");
  });

  test("/effort with no args queries current level", () => {
    const cmd = parseControlCommand("/effort");
    expect(cmd?.type).toBe("thinking");
    expect(cmd && "level" in cmd ? cmd.level : null).toBeFalsy();
  });

  test("/thinking still works as before", () => {
    const cmd = parseControlCommand("/thinking medium");
    expect(cmd?.type).toBe("thinking");
    expect(cmd && "level" in cmd ? cmd.level : null).toBe("medium");
  });
});
