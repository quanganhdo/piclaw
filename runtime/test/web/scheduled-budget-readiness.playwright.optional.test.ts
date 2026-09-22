import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1";
const browserTest = enabled ? test : test.skip;
const runtimeRoot = join(import.meta.dir, "../..");
type Skin = "classic" | "visual";
type Readiness = {
  mode: string;
  status: string;
  checked_at: string;
  summary: string;
  blockers: Array<{ cap_id: string; scope: string; reason: string }>;
  applicable_cap_ids: string[];
  next_steps: string[];
  recheck_at_run: true;
};
const checkedAt = "2026-09-20T08:00:00Z";
const allowed: Readiness = {
  mode: "no_task_cap",
  status: "allowed",
  checked_at: checkedAt,
  summary: "No task cap; currently allowed by applicable budgets.",
  blockers: [],
  applicable_cap_ids: [],
  next_steps: [],
  recheck_at_run: true,
};
function fixtureTask(readiness: Readiness = allowed, existing = false) {
  return {
    id: "fixture-scheduled-agent",
    summary: "Disposable scheduled budget check",
    prompt: "Fixture only; never executed",
    chat_jid: "web:fixture",
    task_kind: "agent",
    status: "active",
    schedule_type: "interval",
    schedule_value: "3600000",
    next_run: "2026-09-20T09:00:00Z",
    last_run: null,
    model: "fixture/model",
    recent_run_logs: [],
    budget_usd: existing ? (readiness.mode === "zero_task_cap" ? 0 : 2) : null,
    budget_cap_enabled: existing,
    // A valid zero revision must not disappear through a truthiness check.
    budget_cap_revision: existing ? 0 : null,
    budget_readiness: structuredClone(readiness),
  };
}
let server: ReturnType<typeof Bun.serve>;
let base = "";
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "fixtures/scheduled-budget-readiness-fixture.ts"),
    ],
    target: "browser",
    format: "esm",
    jsx: { runtime: "automatic", importSource: "preact" },
    external: ["#editor-vendor/codemirror"],
  });
  if (!build.success) throw new Error(build.logs.map(String).join("\n"));
  const bundle = await build.outputs[0].text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/fixture.js")
        return new Response(bundle, {
          headers: { "content-type": "text/javascript" },
        });
      if (url.pathname === "/") {
        const skin =
          url.searchParams.get("skin") === "visual" ? "visual" : "classic";
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/css/styles.css"><script type="importmap">{"imports":{"#editor-vendor/codemirror":"/editor-vendor/codemirror.js"}}</script><style>html,body,#app{margin:0;width:100%;height:100%}</style></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url.pathname === "/editor-vendor/codemirror.js")
        return new Response(
          Bun.file(
            join(runtimeRoot, "extensions/viewers/editor/vendor/codemirror.js"),
          ),
          { headers: { "content-type": "text/javascript" } },
        );
      if (url.pathname.startsWith("/static/") && !url.pathname.includes("..")) {
        const file = Bun.file(
          join(runtimeRoot, "web/static", url.pathname.slice(8)),
        );
        if (await file.exists()) return new Response(file);
      }
      // No real service, provider or scheduler is available at this ephemeral origin.
      return new Response("Fixture route not found", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
  browsers.chromium = await chromium.launch({ headless: true });
  browsers.webkit = await webkit.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await Promise.all(Object.values(browsers).map((browser) => browser.close()));
  server?.stop(true);
});

async function open(
  engine: string,
  skin: Skin,
  options: { existing?: boolean; readiness?: Readiness; width?: number } = {},
) {
  const page = await browsers[engine].newPage({
    viewport: { width: options.width || 1280, height: 844 },
  });
  page.setDefaultTimeout(8000);
  let task = fixtureTask(options.readiness, options.existing);
  const posts: Array<Record<string, unknown>> = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  const dialogs: string[] = [];
  const decisions = { accept: false };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    if (decisions.accept) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin !== base) {
      unexpected.push(`${req.method()} ${url.origin}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/agent/")) {
      await route.continue();
      return;
    }
    if (req.method() === "POST" && url.pathname === "/agent/client-perf") {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (req.method() === "GET" && url.pathname === "/agent/settings-data") {
      await route.fulfill({
        json: {
          version: "fixture",
          assistantName: "Fixture",
          userName: "Fixture",
          models: [],
          model_options: [],
          providers: [],
          toolsets: [],
        },
      });
      return;
    }
    if (req.method() === "GET" && url.pathname === "/agent/scheduled-tasks") {
      await route.fulfill({
        json: {
          ok: true,
          tasks: [task],
          counts: { active: 1, paused: 0, completed: 0 },
          total: 1,
        },
      });
      return;
    }
    if (
      req.method() === "POST" &&
      url.pathname === "/agent/scheduled-tasks/action"
    ) {
      const body = req.postDataJSON() as Record<string, unknown>;
      posts.push(body);
      if (body.action !== "set_budget" || body.id !== task.id)
        unexpected.push(`Unexpected task action: ${JSON.stringify(body)}`);
      if (body.action === "set_budget") {
        const amount =
          body.budget_usd === undefined
            ? task.budget_usd
            : Number(body.budget_usd);
        task = {
          ...task,
          budget_usd: amount,
          budget_cap_enabled: body.enabled !== false,
          budget_cap_revision: (task.budget_cap_revision ?? -1) + 1,
          budget_readiness: {
            ...allowed,
            mode:
              body.enabled === false
                ? "disabled_task_cap"
                : amount === 0
                  ? "zero_task_cap"
                  : "capped",
            status:
              body.enabled !== false && amount === 0 ? "blocked" : "allowed",
          },
        };
      }
      await route.fulfill({ json: { ok: true, task } });
      return;
    }
    unexpected.push(`${req.method()} ${url.pathname}`);
    await route.fulfill({
      status: 404,
      json: { ok: false, error: "Unexpected fixture API" },
    });
  });
  try {
    await page.goto(`${base}/?skin=${skin}`);
    await page
      .getByRole("textbox", { name: "Per-run API-equivalent USD", exact: true })
      .waitFor();
    await page.getByRole("status").filter({ hasText: "Budget:" }).waitFor();
    // Classic selects the first task and refreshes once when its callback dependency changes.
    // Wait for that initial refresh before typing so it cannot replace the edited form.
    await page.waitForLoadState("networkidle");
    return { page, posts, dialogs, decisions, errors, unexpected };
  } catch (error) {
    await page.close();
    throw error;
  }
}
function expectedPayload(skin: Skin, fields: Record<string, unknown>) {
  return {
    action: "set_budget",
    id: "fixture-scheduled-agent",
    ...(skin === "classic" ? { allow_internal: false } : {}),
    ...fields,
  };
}
function clean(fixture: Awaited<ReturnType<typeof open>>) {
  expect(fixture.errors).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
}
async function save(page: Page, existing: boolean) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/agent/scheduled-tasks/action" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: existing ? "Update budget" : "Set budget",
      exact: true,
    })
    .click();
  await response;
  await page
    .getByRole("textbox", { name: "Per-run API-equivalent USD", exact: true })
    .waitFor();
}

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic", "visual"] as const) {
    browserTest(
      `${engine} ${skin}: no_task_cap is allowed without prompts or mutations`,
      async () => {
        const f = await open(engine, skin);
        try {
          const status = f.page
            .getByRole("status")
            .filter({ hasText: "Budget:" });
          expect(await status.innerText()).toContain("Budget: allowed");
          expect(await status.innerText()).toContain(allowed.summary);
          expect(await status.innerText()).toContain("checked");
          expect(await f.page.getByText(/caps reset per run and are not reservations/).isVisible()).toBe(true);
          expect(
            await f.page
              .getByRole("textbox", { name: "Per-run API-equivalent USD" })
              .inputValue(),
          ).toBe("");
          expect(
            await f.page.getByText("Uncapped", { exact: true }).isVisible(),
          ).toBe(true);
          expect(
            await f.page
              .getByRole("button", { name: "Disable", exact: true })
              .count(),
          ).toBe(0);
          expect(f.dialogs).toEqual([]);
          expect(f.posts).toEqual([]);
          clean(f);
        } finally {
          await f.page.close();
        }
      },
      20000,
    );

    browserTest(
      `${engine} ${skin}: readiness status, summary, blockers and next steps fit 390px`,
      async () => {
        const snapshots: Readiness[] = [
          {
            ...allowed,
            mode: "zero_task_cap",
            status: "blocked",
            summary: "The enabled zero task cap blocks model execution.",
            blockers: [
              {
                cap_id: "scheduled-cap:fixture",
                scope: "scheduled_run",
                reason: "zero_ceiling",
              },
            ],
            applicable_cap_ids: ["scheduled-cap:fixture"],
            next_steps: ["Disable the zero cap or set a positive per-run cap."],
          },
          {
            ...allowed,
            mode: "no_task_cap",
            status: "blocked",
            summary: "An instance cap blocks this uncapped task.",
            blockers: [
              {
                cap_id: "instance",
                scope: "instance_window",
                reason: "cap_exhausted",
              },
            ],
            applicable_cap_ids: ["instance"],
            next_steps: [
              "Wait for the instance window reset; a task cap cannot bypass it.",
            ],
          },
          {
            ...allowed,
            status: "check_at_run",
            summary: "Provider-specific caps are checked at execution.",
            next_steps: [
              "Select an explicit provider/model for a fuller preflight check.",
            ],
          },
        ];
        for (const readiness of snapshots) {
          const f = await open(engine, skin, {
            width: 390,
            readiness,
            existing: readiness.mode === "zero_task_cap",
          });
          try {
            const status = f.page
              .getByRole("status")
              .filter({ hasText: "Budget:" });
            await status.scrollIntoViewIfNeeded();
            const text = await status.innerText();
            expect(text).toContain(`Budget: ${readiness.status}`);
            expect(text).toContain(readiness.summary);
            for (const blocker of readiness.blockers)
              expect(text).toContain(`${blocker.scope}: ${blocker.reason}`);
            for (const step of readiness.next_steps)
              expect(text).toContain(step);
            const geometry = await f.page.evaluate(() => {
              const section = document.querySelector(
                ".settings-scheduled-tasks-section, .settings-panel__section--scheduled-tasks",
              )!;
              const root = document.querySelector(
                ".settings-content, .settings-panel__content",
              ) as HTMLElement;
              const bounds = root.getBoundingClientRect();
              return {
                viewportOverflow:
                  document.documentElement.scrollWidth - innerWidth,
                rootOverflow: root.scrollWidth - root.clientWidth,
                outside: Array.from(
                  section.querySelectorAll(
                    '.settings-task-budget-row input, .settings-task-budget-row button, .settings-panel__scheduled-budget input, .settings-panel__scheduled-budget button, [role="status"]',
                  ),
                )
                  .filter((el) => {
                    const r = el.getBoundingClientRect();
                    return (
                      r.width > 0 &&
                      (r.left < bounds.left - 1 || r.right > bounds.right + 1)
                    );
                  })
                  .map((el) => el.outerHTML.slice(0, 120)),
              };
            });
            expect(geometry.viewportOverflow).toBeLessThanOrEqual(1);
            expect(geometry.rootOverflow).toBeLessThanOrEqual(1);
            expect(geometry.outside).toEqual([]);
            expect(
              await f.page
                .getByRole("textbox", {
                  name: "Per-run API-equivalent USD",
                  exact: true,
                })
                .count(),
            ).toBe(1);
            expect(f.dialogs).toEqual([]);
            expect(f.posts).toEqual([]);
            clean(f);
          } finally {
            await f.page.close();
          }
        }
      },
      30000,
    );

    for (const existing of [false, true])
      browserTest(
        `${engine} ${skin}: ${existing ? "existing" : "new"} zero cap needs deliberate confirmation`,
        async () => {
          const f = await open(engine, skin, { existing, width: 390 });
          try {
            const input = f.page.getByRole("textbox", {
              name: "Per-run API-equivalent USD",
              exact: true,
            });
            await input.fill("0");
            await Promise.all([
              f.page.waitForEvent("dialog"),
              f.page
                .getByRole("button", {
                  name: existing ? "Update budget" : "Set budget",
                  exact: true,
                })
                .click(),
            ]);
            await f.page.waitForLoadState("networkidle");
            expect(f.dialogs).toHaveLength(1);
            expect(f.dialogs[0]).toContain(
              "zero task cap blocks model execution",
            );
            expect(f.dialogs[0]).toContain("Disable the cap instead");
            expect(f.posts).toEqual([]);
            expect(await input.inputValue()).toBe("0");
            f.dialogs.length = 0;
            f.decisions.accept = true;
            await input.fill("0.000000");
            await save(f.page, existing);
            expect(f.posts).toEqual([
              expectedPayload(skin, {
                budget_usd: "0.000000",
                enabled: true,
                ...(existing ? { confirm_revision: 0 } : {}),
                confirm_zero_budget: true,
              }),
            ]);
            expect(f.dialogs[0]).toContain(
              "zero task cap blocks model execution",
            );
            expect(f.dialogs).toHaveLength(1);
            clean(f);
          } finally {
            await f.page.close();
          }
        },
        20000,
      );

    for (const existing of [false, true])
      browserTest(
        `${engine} ${skin}: positive ${existing ? "edit" : "new cap"} preserves request shape`,
        async () => {
          const f = await open(engine, skin, { existing });
          try {
            f.decisions.accept = true;
            await f.page
              .getByRole("textbox", {
                name: "Per-run API-equivalent USD",
                exact: true,
              })
              .fill("1.25");
            await save(f.page, existing);
            expect(f.posts).toEqual([
              expectedPayload(skin, {
                budget_usd: "1.25",
                enabled: true,
                ...(existing ? { confirm_revision: 0 } : {}),
              }),
            ]);
            expect(f.dialogs.length).toBeGreaterThan(0);
            expect(
              f.dialogs.every((text) => !text.includes("zero task cap")),
            ).toBe(true);
            clean(f);
          } finally {
            await f.page.close();
          }
        },
        20000,
      );

    browserTest(
      `${engine} ${skin}: disabling an existing cap preserves revision-only payload`,
      async () => {
        const f = await open(engine, skin, { existing: true });
        try {
          f.decisions.accept = true;
          const response = f.page.waitForResponse(
            (r) =>
              r.request().method() === "POST" &&
              new URL(r.url()).pathname === "/agent/scheduled-tasks/action",
          );
          await f.page
            .getByRole("button", { name: "Disable", exact: true })
            .click();
          await response;
          expect(f.posts).toEqual([
            expectedPayload(skin, { enabled: false, confirm_revision: 0 }),
          ]);
          expect(f.dialogs).toHaveLength(1);
          expect(f.dialogs[0]).toContain("Disable");
          expect(f.dialogs[0]).not.toContain("zero task cap");
          clean(f);
        } finally {
          await f.page.close();
        }
      },
      20000,
    );
  }
