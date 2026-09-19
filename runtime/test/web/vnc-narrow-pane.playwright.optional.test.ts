import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const runtimeRoot = join(import.meta.dir, "../..");
const evidence = join(runtimeRoot, "../.artifacts/vnc-narrow-pane");
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
let base = "";
let bundle = "";
const scope = "a".repeat(64);
const longTarget =
  "long-private-desktop-name.for-the-disposable-test.example:5901";

beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "fixtures/vnc-viewer-fixture.ts")],
    target: "browser",
  });
  if (!build.success) throw new Error(String(build.logs));
  bundle = await build.outputs[0].text();
  await mkdir(evidence, { recursive: true });
  browsers.chromium = await chromium.launch({ headless: true });
  browsers.webkit = await webkit.launch({ headless: true });
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/vnc/session")
        return Response.json({
          enabled: true,
          direct_connect_enabled: true,
          history_scope: scope,
          targets: [
            {
              id: "desk",
              label: "Configured development desktop with a long name",
              readOnly: false,
            },
          ],
        });
      if (url.pathname === "/fixture.js")
        return new Response(bundle, {
          headers: { "content-type": "text/javascript" },
        });
      if (url.pathname === "/classic.css")
        return new Response(
          await readFile(
            join(runtimeRoot, "web/static/classic/dist/app.bundle.css"),
          ),
          { headers: { "content-type": "text/css" } },
        );
      // No sockets/upstream VNC in this layout-only fixture.
      if (url.pathname.startsWith("/vnc/"))
        return new Response("Layout fixture: connection disabled", {
          status: 403,
        });
      return new Response(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/classic.css"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:flex;justify-content:flex-end;background:var(--bg-secondary)}#vnc-root{width:var(--pane-width,360px);height:var(--pane-height,620px);min-width:0;border-left:1px solid var(--border-color);box-sizing:content-box;margin-top:24px}</style></head><body><div id="vnc-root"></div><script type="module" src="/fixture.js"></script></body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  base = `http://127.0.0.1:${server.port}`;
}, 30000);
afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  server?.stop(true);
});

async function open(page: Page, width: number, height: number, light = false) {
  await page.addInitScript(
    ({ scope, target }) => {
      localStorage.setItem(
        `piclaw:vnc-history:v1:${scope}`,
        JSON.stringify(
          Array.from({ length: 10 }, (_, i) => ({
            target: i === 0 ? target : `desktop-${i}.example:5901`,
            label:
              i === 0
                ? "A long pinned desktop label that must not squeeze the endpoint form"
                : `Recent desktop ${i}`,
            connectedAt: 1720000000000 - i * 60000,
            pinned: i === 0,
          })),
        ),
      );
    },
    { scope, target: longTarget },
  );
  await page.goto(base);
  await page.evaluate(
    ({ width, height, light }) => {
      document.documentElement.style.setProperty("--pane-width", `${width}px`);
      document.documentElement.style.setProperty(
        "--pane-height",
        `${height}px`,
      );
      document.documentElement.classList.toggle("light", light);
      document.body.classList.toggle("light", light);
    },
    { width, height, light },
  );
  await page.locator("[data-vnc-connect-form]").waitFor();
}
async function geometry(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".vnc-pane-shell") as HTMLElement;
    const manager = document.querySelector(".vnc-manager") as HTMLElement;
    const server = document.querySelector(
      "[data-vnc-direct-host]",
    ) as HTMLElement;
    const port = document.querySelector(
      "[data-vnc-direct-port]",
    ) as HTMLElement;
    const form = server.closest("section")!;
    const saved = document
      .querySelector("[data-vnc-search]")!
      .closest("section")!;
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const bounds = root.getBoundingClientRect();
    return {
      root: rect(root),
      form: rect(form),
      saved: rect(saved),
      host: rect(server),
      port: rect(port),
      overflow: manager.scrollWidth - manager.clientWidth,
      outside: Array.from(manager.querySelectorAll("button,input,summary"))
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.width > 0 &&
            (r.left < bounds.left - 1 || r.right > bounds.right + 1)
          );
        })
        .map((e) => e.outerHTML.slice(0, 110)),
      hostFont: getComputedStyle(server).fontSize,
    };
  });
}

for (const engine of ["chromium", "webkit"])
  for (const width of [280, 360, 520, 680, 900])
    for (const light of [false, true]) {
      browserTest(
        `${engine}: ${width}px VNC pane within a wide viewport (${light ? "light" : "dark"})`,
        async () => {
          const page = await browsers[engine].newPage({
            viewport: { width: 1440, height: 900 },
          });
          page.setDefaultTimeout(8000);
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          try {
            await open(page, width, 620, light);
            const g = await geometry(page);
            expect(g.overflow).toBeLessThanOrEqual(1);
            expect(g.outside).toEqual([]);
            expect(g.host.width).toBeGreaterThanOrEqual(
              width < 320 ? 125 : 170,
            );
            expect(g.port.width).toBeGreaterThanOrEqual(72);
            if (width <= 680)
              expect(g.saved.y).toBeGreaterThanOrEqual(g.form.bottom - 1);
            else expect(Math.abs(g.saved.y - g.form.y)).toBeLessThanOrEqual(1);
            // Long names remain one usable line instead of making an extremely tall, crushed row.
            expect(
              await page
                .locator("[data-vnc-history] .vnc-history-row")
                .first()
                .evaluate((e) => e.getBoundingClientRect().height),
            ).toBeLessThanOrEqual(100);
            await page.locator("[data-vnc-connect-form] summary").click();
            await page.locator("[data-vnc-direct-password]").fill("temporary");
            expect((await geometry(page)).outside).toEqual([]);
            await page.screenshot({
              path: join(
                evidence,
                `${engine}-${width}-${light ? "light" : "dark"}.png`,
              ),
            });
            await page.locator("[data-vnc-search]").fill("Recent desktop 3");
            expect(
              await page.locator("[data-vnc-history] .vnc-history-row").count(),
            ).toBe(1);
            await page.locator("[data-vnc-search]").fill("");
            await page
              .getByRole("button", { name: "Clear recent history" })
              .click();
            expect(
              await page.locator("[data-vnc-history] .vnc-history-row").count(),
            ).toBe(1);
            expect(errors).toEqual([]);
          } finally {
            await page.close();
          }
        },
        20000,
      );
    }

for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: pane-only resizing preserves form/history and short-window scroll`,
    async () => {
      const page = await browsers[engine].newPage({
        viewport: { width: 1440, height: 900 },
      });
      page.setDefaultTimeout(8000);
      try {
        await open(page, 900, 340);
        await page.locator("[data-vnc-direct-host]").fill("my-private-desktop");
        await page.locator("[data-vnc-connect-form] summary").click();
        await page.locator("[data-vnc-direct-password]").fill("memory-only");
        for (const width of [320, 680, 900, 280]) {
          await page.evaluate(
            (w) =>
              document.documentElement.style.setProperty(
                "--pane-width",
                `${w}px`,
              ),
            width,
          );
          const g = await geometry(page);
          expect(g.overflow).toBeLessThanOrEqual(1);
          expect(g.outside).toEqual([]);
          expect(
            await page.locator("[data-vnc-direct-host]").inputValue(),
          ).toBe("my-private-desktop");
          expect(
            await page.locator("[data-vnc-direct-password]").inputValue(),
          ).toBe("memory-only");
          expect(
            await page.locator("[data-vnc-history] .vnc-history-row").count(),
          ).toBe(10);
        }
        await page
          .getByRole("button", { name: "Remove Recent desktop 9", exact: true })
          .click();
        expect(
          await page.locator("[data-vnc-history] .vnc-history-row").count(),
        ).toBe(9);
        await page.locator("[data-vnc-direct-host]").focus();
        await page.keyboard.press("Tab");
        expect(
          await page
            .locator("[data-vnc-direct-port]")
            .evaluate((e) => e === document.activeElement),
        ).toBe(true);
      } finally {
        await page.close();
      }
    },
    20000,
  );
