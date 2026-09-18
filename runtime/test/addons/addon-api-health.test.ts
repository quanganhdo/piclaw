import { beforeEach, describe, expect, test } from "bun:test";

import {
  getAddonApiHealthSnapshot,
  recordAddonApiFailure,
  recordAddonApiSuccess,
  recordAddonApiTransportSelection,
  resetAddonApiHealthForTests,
} from "../../src/addons/addon-api-health.js";

beforeEach(resetAddonApiHealthForTests);

describe("add-on API transport health", () => {
  test("counts direct and legacy transport selections without retaining payloads", () => {
    recordAddonApiTransportSelection({
      addonId: "goal",
      action: "config",
      chatJid: "web:test",
      method: "POST",
      path: "/agent/addons/api/goal/config",
      transport: "direct_handler",
    });
    recordAddonApiTransportSelection({
      addonId: "goal",
      action: "config",
      chatJid: "web:test",
      method: "POST",
      path: "/agent/addons/api/goal/config",
      transport: "legacy_slash_command",
    });

    expect(getAddonApiHealthSnapshot()).toEqual({
      degraded: false,
      entries: [],
      transportCounts: { direct_handler: 1, legacy_slash_command: 1 },
    });
  });

  test("retains the transport on failure and recovery", () => {
    recordAddonApiTransportSelection({
      addonId: "goal",
      action: "config",
      transport: "legacy_slash_command",
    });
    const failure = recordAddonApiFailure({
      addonId: "goal",
      action: "config",
      transport: "legacy_slash_command",
      status: 502,
      error: "invalid response",
    });
    expect(failure.transport).toBe("legacy_slash_command");

    const recovery = recordAddonApiSuccess({
      addonId: "goal",
      action: "config",
      transport: "direct_handler",
    });
    expect(recovery?.transport).toBe("direct_handler");
    expect(getAddonApiHealthSnapshot()).toEqual({
      degraded: false,
      entries: [],
      transportCounts: { direct_handler: 0, legacy_slash_command: 1 },
    });
  });
});
