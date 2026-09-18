import { describe, expect, mock, test } from "bun:test";

import {
  createLazyTerminalService,
  createLazyVncService,
} from "../../../src/channels/web/lazy-session-services.js";

describe("web channel lazy session services", () => {
  test("untouched shutdown does not create terminal or VNC services", () => {
    const terminalFactory = mock(() => ({ shutdown: mock(() => {}) } as any));
    const vncFactory = mock(() => ({ shutdown: mock(() => {}) } as any));

    const terminal = createLazyTerminalService(terminalFactory);
    const vnc = createLazyVncService(vncFactory);

    terminal.shutdown();
    terminal.shutdown();
    vnc.shutdown();
    vnc.shutdown();

    expect(terminalFactory).not.toHaveBeenCalled();
    expect(vncFactory).not.toHaveBeenCalled();
  });

  test("terminal use creates once and repeated shutdown forwards to the existing service", () => {
    const shutdown = mock(() => {});
    const getSessionInfo = mock(() => ({ active: false }));
    const terminalFactory = mock(() => ({ getSessionInfo, shutdown } as any));
    const terminal = createLazyTerminalService(terminalFactory);
    const owner = { token: "terminal-token", userId: "user-1" };

    expect(terminal.getSessionInfo(owner)).toEqual({ active: false });
    expect(terminal.getSessionInfo(owner)).toEqual({ active: false });
    terminal.shutdown();
    terminal.shutdown();

    expect(terminalFactory).toHaveBeenCalledTimes(1);
    expect(getSessionInfo).toHaveBeenCalledTimes(2);
    expect(shutdown).toHaveBeenCalledTimes(2);
  });

  test("VNC use creates once and repeated shutdown forwards to the existing service", async () => {
    const shutdown = mock(() => {});
    const prepareTargetReference = mock(async (targetRef: string) => ({ ok: true, targetRef }));
    const vncFactory = mock(() => ({ prepareTargetReference, shutdown } as any));
    const vnc = createLazyVncService(vncFactory);

    expect(await vnc.prepareTargetReference("desktop-a")).toEqual({ ok: true, targetRef: "desktop-a" });
    expect(await vnc.prepareTargetReference("desktop-b")).toEqual({ ok: true, targetRef: "desktop-b" });
    vnc.shutdown();
    vnc.shutdown();

    expect(vncFactory).toHaveBeenCalledTimes(1);
    expect(prepareTargetReference).toHaveBeenCalledTimes(2);
    expect(shutdown).toHaveBeenCalledTimes(2);
  });
});
