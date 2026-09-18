import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "../../helpers.js";
import {
  clearExtensionRoutes,
  freezeExtensionRoutes,
  getExtensionRouteConflicts,
  getRegisteredRoutes,
  handleExtensionRoutes,
  isExtensionRouteRegistryFrozen,
  registerExtensionRoute,
} from "../../../src/channels/web/http/extension-routes.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../../src/utils/logger.js";

beforeEach(() => {
  clearExtensionRoutes();
});

afterEach(() => {
  clearExtensionRoutes();
});

describe("extension route registry", () => {
  test("dedupes repeated registrations for the same prefix and extension path", async () => {
    const first = registerExtensionRoute("/example-addon", () => new Response("first"), "/ext/example-addon");
    const second = registerExtensionRoute("/example-addon", () => new Response("second"), "/ext/example-addon");

    expect(first).toBe("created");
    expect(second).toBe("updated");
    expect(getRegisteredRoutes()).toMatchObject([
      { prefix: "/example-addon", extensionPath: "/ext/example-addon" },
    ]);

    const response = await handleExtensionRoutes(new Request("http://localhost/example-addon/edit"), "/example-addon/edit");
    expect(response).not.toBeNull();
    expect(await response!.text()).toBe("second");
  });

  test("diagnoses exact cross-owner prefixes without changing first-response dispatch", async () => {
    const logs: LogRecord[] = [];
    const sink = (record: LogRecord) => logs.push(record);
    addLogSink(sink);
    try {
      registerExtensionRoute("/example-addon", () => new Response("first"), "/ext/example-addon-a");
      registerExtensionRoute("/example-addon", () => new Response("second"), "/ext/example-addon-b");

      expect(getRegisteredRoutes()).toMatchObject([
        { prefix: "/example-addon", extensionPath: "/ext/example-addon-a" },
        { prefix: "/example-addon", extensionPath: "/ext/example-addon-b" },
      ]);
      expect(getExtensionRouteConflicts()).toEqual([{
        type: "exact",
        prefix: "/example-addon",
        extensionPath: "/ext/example-addon-b",
        conflictingPrefix: "/example-addon",
        conflictingExtensionPath: "/ext/example-addon-a",
      }]);
      expect(logs.find((record) => record.operation === "web_extension_routes.register_conflict")).toMatchObject({
        type: "exact",
        prefix: "/example-addon",
        extensionPath: "/ext/example-addon-b",
        conflictingExtensionPath: "/ext/example-addon-a",
      });

      const response = await handleExtensionRoutes(new Request("http://localhost/example-addon"), "/example-addon");
      expect(await response?.text()).toBe("first");
    } finally {
      removeLogSink(sink);
    }
  });

  test("diagnoses nested owners and preserves intentional null fall-through", async () => {
    const calls: string[] = [];
    registerExtensionRoute("/example-addon", () => {
      calls.push("parent");
      return null;
    }, "/ext/example-addon-parent");
    registerExtensionRoute("/example-addon/files", () => {
      calls.push("nested");
      return new Response("nested response");
    }, "/ext/example-addon-files");

    expect(getExtensionRouteConflicts()).toEqual([{
      type: "nested",
      prefix: "/example-addon/files",
      extensionPath: "/ext/example-addon-files",
      conflictingPrefix: "/example-addon",
      conflictingExtensionPath: "/ext/example-addon-parent",
    }]);

    const response = await handleExtensionRoutes(
      new Request("http://localhost/example-addon/files/one"),
      "/example-addon/files/one",
    );
    expect(await response?.text()).toBe("nested response");
    expect(calls).toEqual(["parent", "nested"]);
  });

  test("allows updates to an already-registered route after freeze", async () => {
    registerExtensionRoute("/example-addon", () => new Response("first"), "/ext/example-addon");
    freezeExtensionRoutes();

    const updated = registerExtensionRoute("/example-addon", () => new Response("second"), "/ext/example-addon");

    expect(updated).toBe("updated");
    expect(getExtensionRouteConflicts()).toEqual([]);
    const response = await handleExtensionRoutes(new Request("http://localhost/example-addon"), "/example-addon");
    expect(await response?.text()).toBe("second");
  });

  test("keeps registry open until runtime startup freezes it so workspace extensions can register during session load", async () => {
    expect(isExtensionRouteRegistryFrozen()).toBe(false);

    const registered = (globalThis as any).__piclaw_registerRoute(
      "/workspace-addon",
      () => new Response("workspace route"),
      "/workspace/.pi/extensions/workspace-addon/index.ts"
    );

    expect(registered).toBe("created");
    expect(getRegisteredRoutes().map((route) => route.prefix)).toContain("/workspace-addon");

    const response = await handleExtensionRoutes(new Request("http://localhost/workspace-addon"), "/workspace-addon");
    expect(await response?.text()).toBe("workspace route");

    freezeExtensionRoutes();
    expect(isExtensionRouteRegistryFrozen()).toBe(true);
    expect(registerExtensionRoute("/late-addon", () => new Response("late"), "/ext/late")).toBe("rejected");
  });
});
