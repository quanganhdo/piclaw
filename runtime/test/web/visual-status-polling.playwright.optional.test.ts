import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, webkit, type Browser } from "playwright";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  if (!enabled) return;
  const built = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "fixtures/visual-status-polling-fixture.tsx"),
    ],
    target: "browser",
    jsx: { runtime: "automatic", importSource: "preact" },
  });
  if (!built.success) throw Error(String(built.logs));
  const script = await built.outputs[0].text();
  const classic = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "fixtures/classic-model-refresh-fixture.ts"),
    ],
    target: "browser",
    external: ["#editor-vendor/codemirror"],
  });
  if (!classic.success) throw Error(String(classic.logs));
  const classicScript = await classic.outputs[0].text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/editor-vendor/codemirror.js"
        ? new Response(
            Bun.file(
              join(
                import.meta.dir,
                "../../extensions/viewers/editor/vendor/codemirror.js",
              ),
            ),
            { headers: { "content-type": "text/javascript" } },
          )
        : new URL(req.url).pathname === "/fixture.js"
          ? new Response(
              new URL(req.url).searchParams.get("skin") === "classic"
                ? classicScript
                : script,
              {
                headers: { "content-type": "text/javascript" },
              },
            )
          : new Response(
              `<!doctype html><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><div id="app"></div><script type="module" src="/fixture.js?skin=${new URL(req.url).searchParams.get("skin") || "visual"}"></script>`,
              { headers: { "content-type": "text/html" } },
            ),
  });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
});
afterAll(async () => {
  for (const browser of Object.values(browsers)) await browser.close();
  server?.stop(true);
});
for (const engine of ["chromium", "webkit"])
  for (const scenario of [
    "cadence",
    "events",
    "late-body",
    "refresh-disposal",
    "model-during-body",
    "hybrid-budget",
  ])
    browserTest(
      `${engine}: shared Visual polling ${scenario}`,
      async () => {
        const page = await browsers[engine].newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        try {
          await page.clock.install();
          await page.goto(`${server.url}?chat_jid=web%3Atest`);
          await page.waitForSelector("#status-state");
          await page.clock.runFor(100);
          const calls = () =>
            page.evaluate(() =>
              (window as any).pollingFixture.calls.map((c: any) => c.path),
            );
          const reset = () =>
            page.evaluate(() => (window as any).pollingFixture.clear());
          const dispatch = (name: string, detail?: unknown) =>
            page.evaluate(
              ({ name, detail }) =>
                window.dispatchEvent(new CustomEvent(name, { detail })),
              { name, detail },
            );
          expect((await calls()).sort()).toEqual(["/agent/status"]);
          expect(
            await page.locator(".model-badge__name").allTextContents(),
          ).toEqual(["model", "model"]);
          expect(
            await page.evaluate(() =>
              (window as any).pollingFixture.calls
                .filter((c: any) => c.path !== "/agent/roster")
                .every((c: any) => c.jid === "web:test"),
            ),
          ).toBe(true);
          await reset();
          if (scenario === "hybrid-budget") {
            // Independent Classic callers join Visual's timer and shared reply.
            for (let i = 0; i < 12; i++) {
              await page.clock.runFor(5000);
              await page.evaluate(() =>
                (window as any).pollingFixture.classicRefresh(),
              );
            }
            expect(await calls()).toHaveLength(12);
            expect(
              (await calls()).every((path) => path === "/agent/status"),
            ).toBe(true);
          } else if (scenario === "cadence") {
            await page.clock.runFor(5000);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await reset();
            await page.clock.runFor(5000);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMobile(false),
            );
            await page.clock.runFor(100);
            await reset();
            await page.clock.runFor(5000);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMobile(true),
            );
            await page.clock.runFor(100);
            expect(await page.locator(".model-badge__name").count()).toBe(2);
            await page.evaluate(() =>
              (window as any).pollingFixture.setStatusCode(500),
            );
            await page.clock.runFor(35000);
            expect(
              JSON.parse(await page.locator("#status-state").innerText()).stale,
            ).toBe(true);
            await page.evaluate(() =>
              (window as any).pollingFixture.setStatusCode(200),
            );
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect(
              JSON.parse(await page.locator("#status-state").innerText()).stale,
            ).toBe(false);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMounted(false),
            );
            await page.clock.runFor(100);
            await reset();
            await page.clock.runFor(20000);
            expect(await calls()).toEqual([]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMounted(true),
            );
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
          } else if (scenario === "events") {
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await reset();
            await dispatch("piclaw:model-state-changed", {
              chatJid: "web:other",
              payload: { current: "fixture/wrong" },
            });
            await page.clock.runFor(100);
            expect(await calls()).toEqual([]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setModel("fixture/next"),
            );
            await dispatch("piclaw:model-state-changed", {
              chatJid: "web:test",
              payload: {
                current: "fixture/next",
                thinking_level: "high",
                model_options: [{ id: "fixture/next", context_window: 100000 }],
              },
            });
            expect(
              await page.locator(".model-badge__name").allTextContents(),
            ).toEqual(["next", "next"]);
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await reset();
            await dispatch("piclaw:agent-status", {
              type: "done",
              context_usage: {
                tokens: 4000,
                percent: 4,
                contextWindow: 100000,
              },
            });
            expect(
              JSON.parse(await page.locator("#status-state").innerText())
                .tokens,
            ).toBe(4000);
            await page.clock.runFor(600);
            expect(await calls()).toEqual(["/agent/status"]);
            await reset();
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
          } else if (scenario === "model-during-body") {
            await page.evaluate(() => (window as any).pollingFixture.block());
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            await page.evaluate(() =>
              (window as any).pollingFixture.setModel("fixture/latest"),
            );
            await dispatch("piclaw:model-state-changed", {
              chatJid: "web:test",
              payload: { current: "fixture/latest" },
            });
            await page.clock.runFor(100);
            await page.evaluate(() => (window as any).pollingFixture.release());
            await page.clock.runFor(100);
            expect(
              await page.locator(".model-badge__name").allTextContents(),
            ).toEqual(["latest", "latest"]);
            expect(await calls()).toEqual(["/agent/status", "/agent/status"]);
          } else if (scenario === "late-body") {
            await page.evaluate(() => (window as any).pollingFixture.block());
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect((await calls()).sort()).toEqual(["/agent/status"]);
            await page.evaluate(() =>
              (window as any).pollingFixture.setMounted(false),
            );
            await page.clock.runFor(100);
            // Shared transport is not aborted by a single consumer unmount.
            await reset();
            await page.evaluate(() => (window as any).pollingFixture.release());
            await page.clock.runFor(20000);
            expect(await calls()).toEqual([]);
            expect(await page.locator("#status-state").count()).toBe(0);
          } else {
            await dispatch("piclaw:agent-status", { type: "done" });
            await page.evaluate(() =>
              (window as any).pollingFixture.setMounted(false),
            );
            await page.clock.runFor(100);
            await reset();
            await page.clock.runFor(20000);
            expect(await calls()).toEqual([]);
            await dispatch("piclaw:sse-connected");
            await page.clock.runFor(100);
            expect(await calls()).toEqual([]);
          }
          expect(errors).toEqual([]);
        } finally {
          await page.close();
        }
      },
      20000,
    );

for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: Classic model metadata survives same-chat renders, partial updates and request races`,
    async () => {
      const page = await browsers[engine].newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.clock.install();
        await page.goto(`${server.url}?skin=classic`);
        await page.waitForSelector("#classic-state");
        await page.clock.runFor(150);
        const state = async () =>
          JSON.parse(await page.locator("#classic-state").innerText());
        expect((await state()).model).toBe("fixture/model");
        expect((await state()).thinking).toBe("High");
        await page.evaluate(() => (window as any).classicFixture.rerender());
        await page.clock.runFor(100);
        expect((await state()).model).toBe("fixture/model");
        expect((await state()).thinking).toBe("High");
        await page.evaluate(async () => {
          const f = (window as any).classicFixture;
          f.setModel({
            current: "fixture/model",
            provider_usage: { hint_short: "usage" },
          });
          await f.refresh();
        });
        await page.clock.runFor(100);
        expect((await state()).thinking).toBe("High");
        expect((await state()).supports).toBe(true);
        await page.evaluate(async () => {
          const f = (window as any).classicFixture;
          f.fail(true);
          await f.refresh();
        });
        await page.clock.runFor(100);
        expect((await state()).model).toBe("fixture/model");
        await page.evaluate(() => {
          const f = (window as any).classicFixture;
          f.fail(false);
          f.block();
          void f.refresh();
        });
        await page.clock.runFor(100);
        await page.evaluate(() =>
          (window as any).classicFixture.apply({
            current: "fixture/new",
            thinking_level: "off",
            supports_thinking: true,
          }),
        );
        await page.clock.runFor(100);
        await page.evaluate(() => (window as any).classicFixture.release());
        await page.clock.runFor(100);
        expect((await state()).model).toBe("fixture/new");
        expect((await state()).thinking).toBe("off");
        await page.evaluate(() =>
          (window as any).classicFixture.apply({
            thinking_level_label: "Maximum",
          }),
        );
        await page.clock.runFor(100);
        expect((await state()).thinking).toBe("Maximum");
        await page.evaluate(() => {
          const f = (window as any).classicFixture;
          f.block();
          f.setModel({ current: "fixture/wrong-old" });
          void f.refresh();
        });
        await page.clock.runFor(100);
        await page.evaluate(() => {
          const f = (window as any).classicFixture;
          f.fail(true);
          f.changeChat("web:b");
        });
        await page.clock.runFor(100);
        await page.evaluate(() => (window as any).classicFixture.release());
        await page.clock.runFor(100);
        expect((await state()).model).toBeNull();
        await page.evaluate(async () => {
          const f = (window as any).classicFixture;
          f.fail(false);
          f.setModel({
            current: null,
            available_model_count: 2,
            model_options: [],
            thinking_level: null,
          });
          await f.refresh();
        });
        await page.clock.runFor(100);
        expect(
          await page
            .getByRole("button", { name: "Open model picker" })
            .textContent(),
        ).toContain("Select model");
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    },
    20000,
  );
for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: Visual uses authoritative model state and rejects stale context`,
    async () => {
      const page = await browsers[engine].newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.clock.install();
        await page.goto(`${server.url}?chat_jid=web%3Atest`);
        await page.waitForSelector("#status-state");
        await page.clock.runFor(100);
        const refresh = async (value: any) => {
          await page.evaluate((value) => {
            (window as any).pollingFixture.setSnapshot(value);
            window.dispatchEvent(new Event("piclaw:sse-connected"));
          }, value);
          await page.clock.runFor(100);
        };
        await refresh({
          status: {
            status: "idle",
            data: { model: "fixture/old", thinking_level: "low" },
          },
        });
        expect(
          await page.locator(".model-badge__name").allTextContents(),
        ).toEqual(["model", "model"]);
        expect(await page.locator(".thinking-badge").allTextContents()).toEqual(
          ["medium", "medium"],
        );
        await refresh({ model: { current: "fixture/model" } });
        expect(await page.locator(".thinking-badge").allTextContents()).toEqual(
          ["medium", "medium"],
        );
        await refresh({ model: { thinking_level_label: "Maximum" } });
        expect(await page.locator(".thinking-badge").allTextContents()).toEqual(
          ["Maximum", "Maximum"],
        );
        await refresh({
          model: null,
          context: null,
          errors: ["model", "context"],
        });
        expect(
          await page.locator(".model-badge__name").allTextContents(),
        ).toEqual(["model", "model"]);
        expect(await page.locator(".thinking-badge").allTextContents()).toEqual(
          ["Maximum", "Maximum"],
        );
        await refresh({
          model: {
            current: "fixture/new",
            supports_thinking: false,
            thinking_level: null,
            model_options: [{ id: "fixture/new", context_window: 80000 }],
          },
          context: {
            tokens: 0,
            percent: 0,
            contextWindow: 80000,
            sessionGeneration: "new",
          },
        });
        expect(await page.locator(".thinking-badge").count()).toBe(0);
        expect(
          JSON.parse(await page.locator("#status-state").innerText()).tokens,
        ).toBe(0);
        await page.evaluate(() => {
          const f = (window as any).pollingFixture;
          f.block();
          f.setSnapshot({
            model: { current: "fixture/new" },
            context: {
              tokens: 10,
              percent: 0.0125,
              contextWindow: 80000,
              sessionGeneration: "new",
            },
          });
          window.dispatchEvent(new Event("piclaw:sse-connected"));
        });
        await page.clock.runFor(100);
        await page.evaluate(() =>
          window.dispatchEvent(
            new CustomEvent("piclaw:agent-status", {
              detail: {
                type: "context_usage",
                chat_jid: "web:test",
                context_usage: {
                  tokens: 900,
                  percent: 1.125,
                  contextWindow: 80000,
                  sessionGeneration: "new",
                },
              },
            }),
          ),
        );
        await page.evaluate(() => (window as any).pollingFixture.release());
        await page.clock.runFor(100);
        expect(
          JSON.parse(await page.locator("#status-state").innerText()).tokens,
        ).toBe(900);
        await refresh({
          model: { current: null },
          status: {
            status: "idle",
            data: { model: "fixture/old", thinking_level: "low" },
          },
          context: {
            tokens: null,
            percent: null,
            contextWindow: null,
            sessionGeneration: "clear",
          },
        });
        expect(await page.locator(".model-badge__name").count()).toBe(0);
        expect(await page.locator(".thinking-badge").count()).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    },
    20000,
  );

for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: Visual clears across chat navigation and session generation reset`,
    async () => {
      const page = await browsers[engine].newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.clock.install();
        await page.goto(`${server.url}?chat_jid=web%3Atest`);
        await page.waitForSelector("#status-state");
        await page.clock.runFor(100);
        await page.evaluate(() => {
          const f = (window as any).pollingFixture;
          f.setSnapshot({
            context: {
              tokens: 500,
              contextWindow: 200000,
              percent: 0.25,
              sessionGeneration: "before",
            },
          });
          window.dispatchEvent(new Event("piclaw:sse-connected"));
        });
        await page.clock.runFor(100);
        await page.evaluate(() => {
          const f = (window as any).pollingFixture;
          f.block();
          window.dispatchEvent(new Event("piclaw:sse-connected"));
        });
        await page.clock.runFor(100);
        await page.evaluate(() => {
          const f = (window as any).pollingFixture;
          history.replaceState({}, "", "?chat_jid=web%3Aother");
          f.setStatusCode(500);
          window.dispatchEvent(
            new CustomEvent("piclaw:current-chat-changed", {
              detail: { chatJid: "web:other" },
            }),
          );
        });
        await page.clock.runFor(100);
        expect(await page.locator(".model-badge__name").count()).toBe(0);
        expect(await page.locator(".thinking-badge").count()).toBe(0);
        expect(
          JSON.parse(await page.locator("#status-state").innerText()).tokens,
        ).toBeUndefined();
        await page.evaluate(() => (window as any).pollingFixture.release());
        await page.clock.runFor(100);
        expect(await page.locator(".model-badge__name").count()).toBe(0);
        await page.evaluate(() => {
          const f = (window as any).pollingFixture;
          f.setStatusCode(200);
          f.setModel("fixture/other");
          f.setSnapshot({
            context: {
              tokens: 20,
              percent: 0.02,
              contextWindow: 100000,
              sessionGeneration: "new",
            },
          });
          window.dispatchEvent(new Event("piclaw:sse-connected"));
        });
        await page.clock.runFor(100);
        expect(
          await page.locator(".model-badge__name").allTextContents(),
        ).toEqual(["other", "other"]);
        await page.evaluate(() =>
          window.dispatchEvent(
            new CustomEvent("piclaw:agent-status", {
              detail: {
                chat_jid: "web:test",
                type: "done",
                context_usage: {
                  tokens: 9999,
                  percent: 99,
                  contextWindow: 10000,
                  sessionGeneration: "before",
                },
              },
            }),
          ),
        );
        await page.clock.runFor(100);
        expect(
          JSON.parse(await page.locator("#status-state").innerText()).tokens,
        ).toBe(20);
        await page.evaluate(() => {
          const f = (window as any).pollingFixture;
          f.setSnapshot({
            context: {
              tokens: null,
              percent: null,
              contextWindow: 100000,
              sessionGeneration: "reset",
            },
          });
          window.dispatchEvent(new Event("piclaw:sse-connected"));
        });
        await page.clock.runFor(100);
        expect(
          JSON.parse(await page.locator("#status-state").innerText()).tokens,
        ).toBeNull();
        await page.evaluate(() =>
          window.dispatchEvent(
            new CustomEvent("piclaw:agent-status", {
              detail: {
                chat_jid: "web:other",
                type: "context_usage",
                context_usage: {
                  tokens: 9999,
                  percent: 99,
                  contextWindow: 10000,
                  sessionGeneration: "new",
                },
              },
            }),
          ),
        );
        await page.clock.runFor(100);
        expect(
          JSON.parse(await page.locator("#status-state").innerText()).tokens,
        ).toBeNull();
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    },
    20000,
  );
