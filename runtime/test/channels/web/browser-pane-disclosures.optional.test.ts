import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;

browserTest("Classic Draft, Thoughts and Output use one accessible disclosure pill", async () => {
  const web = new URL("../../../web/", import.meta.url).pathname;
  const scratch = await mkdtemp(join(tmpdir(), "pane-disclosure-"));
  const unexpected: string[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const entry = join(scratch, "fixture.ts");
    await Bun.write(entry, `
      import { html, render } from ${JSON.stringify(join(web, "src/vendor/preact-htm.js"))};
      import { AgentStatus } from ${JSON.stringify(join(web, "src/components/status.ts"))};
      window.paneToggles = [];
      window.renderPaneFixture = props => render(html\`<\${AgentStatus} ...\${props}
        turnId="fixture-turn" loadWorkspaceBranch=\${async () => ({branch:"fixture"})}
        onPanelToggle=\${(key, expanded) => window.paneToggles.push({key, expanded})} />\`, document.getElementById("fixture"));
    `);
    const built = await Bun.build({ entrypoints: [entry], outdir: scratch, target: "browser", format: "esm" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        const skin = url.searchParams.get("skin") === "visual" ? "visual" : "classic";
        const body = url.searchParams.has("viewport")
          ? '<div class="app-shell chat-only"><div class="container" style="margin:0;width:100%;max-width:none"><div class="timeline">Timeline</div><div id="fixture" style="display:contents"></div><div class="chat-surface-compose" style="flex-shrink:0"><div id="fixture-compose" style="height:72px">Composer</div></div></div></div>'
          : '<main id="fixture" style="margin:16px;max-width:900px"></main>';
        return new Response(`<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/dist/app.bundle.css"></head><body>${body}<script type="module" src="/fixture.js"></script></body></html>`, {headers:{"Content-Type":"text/html"}});
      }
      if (url.pathname === "/fixture.js") return new Response(Bun.file(join(scratch, "fixture.js")));
      if (url.pathname.startsWith("/static/")) return new Response(Bun.file(join(web, url.pathname)));
      unexpected.push(url.pathname); return new Response("Unexpected request", {status:404});
    } });
    const origin = `http://127.0.0.1:${server.port}`;
    browser = await chromium.launch({ headless: true });
    const lines = (prefix: string, n = 24) => Array.from({length:n}, (_, i) => `${prefix}${String(i+1).padStart(2,"0")}`).join("\n");
    const props = {thought:lines("THOUGHT"),draft:lines("DRAFT"),status:{type:"tool",title:"Fixture tool",tool_name:"bash",tool_args:"fixture",output_preview:lines("OUTPUT"),output_total_lines:24}};
    for (const width of [1100, 768, 390]) {
      const skin = "classic";
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      page.setDefaultTimeout(5000);
      // Preact installs the document Escape listener after paint. Let those
      // effects settle before testing keyboard input, including initial turn reset.
      const settleEffects = () => page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
      }));
      await page.route("**/*", route => {
        if (!route.request().url().startsWith(origin + "/")) {unexpected.push("external request"); return route.abort();}
        return route.continue();
      });
      await page.goto(`${origin}/?skin=${skin}`);
      await page.waitForFunction(() => typeof (window as any).renderPaneFixture === "function");
      await page.evaluate(p => (window as any).renderPaneFixture(p), props);
      await settleEffects();
      for (const [key, title, prefix] of [["draft","Draft","DRAFT"],["thought","Thoughts","THOUGHT"],["tool-output","Output","OUTPUT"]]) {
        const pane = page.locator(`.agent-thinking[data-panel-key="${key}"]`);
        const header = pane.locator(".agent-thinking-title");
        const pill = header.locator("button.agent-thinking-truncation");
        await pane.waitFor();
        expect(await header.evaluate(el => el.tagName)).toBe("DIV");
        expect(await header.locator("button").count()).toBe(1);
        expect(await header.locator(".ui-disclosure-triangle").count()).toBe(0);
        expect(await pill.innerText()).toBe("more…");
        expect(await pill.getAttribute("aria-label")).toBe(`Expand ${title}`);
        expect(await pill.getAttribute("aria-expanded")).toBe("false");
        const geometry = await pill.evaluate(el => ({width:el.getBoundingClientRect().width,parent:el.parentElement!.getBoundingClientRect().width,radius:parseFloat(getComputedStyle(el).borderRadius)}));
        expect(geometry.width).toBeLessThan(geometry.parent / 2); expect(geometry.radius).toBeGreaterThan(12);
        await header.locator(".agent-thinking-title-text").click();
        expect(await pane.getAttribute("data-expanded")).toBe("false");
        expect(await pane.locator(".agent-thinking-body").innerText()).not.toContain(prefix + "01");
        await pill.focus(); await page.keyboard.press("Enter");
        await page.waitForFunction(k => document.querySelector(`.agent-thinking[data-panel-key="${k}"]`)?.getAttribute("data-expanded") === "true", key);
        await settleEffects();
        expect(await pill.innerText()).toBe("less");
        expect(await pane.locator(".agent-thinking-body").innerText()).toContain(prefix + "01");
        if (key === "thought" || key === "draft") await page.keyboard.press("Escape");
        else await pill.click();
        await page.waitForFunction(k => document.querySelector(`.agent-thinking[data-panel-key="${k}"]`)?.getAttribute("data-expanded") === "false", key);
      }
      const thought = page.locator('.agent-thinking[data-panel-key="thought"]');
      await thought.locator("button.agent-thinking-truncation").click();
      await page.evaluate(p => (window as any).renderPaneFixture(p), {...props, thought:lines("THOUGHT",25)});
      expect(await thought.getAttribute("data-expanded")).toBe("true");
      expect(await thought.locator(".agent-thinking-body").innerText()).toContain("THOUGHT25");
      await thought.locator("button.agent-thinking-truncation").click();
      await page.evaluate(() => (window as any).renderPaneFixture({thought:"short thought",draft:"short draft",status:{type:"tool",output_preview:"short output"}}));
      await page.waitForFunction(() => document.querySelectorAll("button.agent-thinking-truncation").length === 0);
      expect(await page.locator(".agent-thinking-title-clickable").count()).toBe(0);
      // One logical line may still overflow through wrapping. Expanding removes
      // measured overflow, but must retain the less pill until explicitly closed.
      await page.evaluate(() => (window as any).renderPaneFixture({thought:"WRAPPED ".repeat(500)}));
      const wrappedPill = thought.locator("button.agent-thinking-truncation");
      await wrappedPill.waitFor();
      expect(await wrappedPill.innerText()).toBe("more…");
      await wrappedPill.click();
      await settleEffects();
      expect(await wrappedPill.innerText()).toBe("less");
      expect(await thought.locator(".agent-thinking-body").evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      await page.evaluate(() => (window as any).renderPaneFixture({thought:"short while expanded"}));
      await settleEffects();
      expect(await wrappedPill.innerText()).toBe("less");
      await wrappedPill.click();
      await page.waitForFunction(() => document.querySelectorAll("button.agent-thinking-truncation").length === 0);
      expect(await page.evaluate(() => (window as any).paneToggles)).toEqual([
        {key:"draft",expanded:true},{key:"draft",expanded:false},
        {key:"thought",expanded:true},{key:"thought",expanded:false},
        {key:"tool-output",expanded:true},{key:"tool-output",expanded:false},
        {key:"thought",expanded:true},{key:"thought",expanded:false},
        {key:"thought",expanded:true},{key:"thought",expanded:false},
      ]);
      expect(errors).toEqual([]);
      await page.close();
    }
    // Use the real chat flex/overflow layout: a tall pane must not displace the
    // composer or make its sole collapse control unreachable in a short window.
    for (const viewport of [{width:1100,height:600},{width:768,height:360},{width:390,height:700}]) {
      const page = await browser.newPage({viewport});
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.route("**/*", route => {
        if (!route.request().url().startsWith(origin + "/")) {unexpected.push("external request"); return route.abort();}
        return route.continue();
      });
      await page.goto(`${origin}/?viewport=1`);
      await page.waitForFunction(() => typeof (window as any).renderPaneFixture === "function");
      const settle = () => page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
      }));
      for (const [key, prefix] of [["draft","LONGDRAFT"],["thought","LONGTHOUGHT"],["tool-output","LONGOUTPUT"]]) {
        await page.setViewportSize(viewport);
        const text = lines(prefix, 1000);
        await page.evaluate(p => (window as any).renderPaneFixture(p), key === "tool-output"
          ? {status:{type:"tool",output_preview:text,output_total_lines:1000}}
          : {[key]:text});
        await settle();
        const pane = page.locator(`.agent-thinking[data-panel-key="${key}"]`);
        const group = page.locator(".agent-status-panel");
        const pill = pane.locator("button.agent-thinking-truncation");
        await pill.click();
        await page.waitForFunction(k => document.querySelector(`.agent-thinking[data-panel-key="${k}"]`)?.getAttribute("data-expanded") === "true", key);
        await settle();
        const region = (await group.boundingBox())!;
        const composer = (await page.locator("#fixture-compose").boundingBox())!;
        expect(region.y).toBeGreaterThanOrEqual(0);
        expect(region.y + region.height).toBeLessThanOrEqual(composer.y + 1);
        expect(composer.y + composer.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(await pill.innerText()).toBe("less");
        const checkControl = async (height: number) => {
          const r = (await pill.boundingBox())!;
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.y + r.height).toBeLessThanOrEqual(height + 1);
        };
        await checkControl(viewport.height);
        await group.evaluate(el => {el.scrollTop = el.scrollHeight;});
        await settle();
        expect(await group.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
        await checkControl(viewport.height);
        const tail = await pane.locator(".agent-thinking-body").evaluate((el, token) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const offset = (node.textContent || "").lastIndexOf(token);
            if (offset < 0) continue;
            const range = document.createRange();range.setStart(node, offset);range.setEnd(node, offset + token.length);
            const r = range.getBoundingClientRect();return {top:r.top,bottom:r.bottom};
          }
          throw new Error("Last line missing");
        }, prefix + "1000");
        expect(tail.top).toBeGreaterThanOrEqual(region.y - 1);
        expect(tail.bottom).toBeLessThanOrEqual(region.y + region.height + 1);
        // Dynamic viewport changes include tablet rotation and keyboard-sized windows.
        const shorter = Math.max(240, viewport.height - 120);
        await page.setViewportSize({width:viewport.width,height:shorter});
        await settle();
        await checkControl(shorter);
        expect(await page.locator("#fixture-compose").evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(shorter + 1);
        await pill.click();
        await page.waitForFunction(k => document.querySelector(`.agent-thinking[data-panel-key="${k}"]`)?.getAttribute("data-expanded") === "false", key);
      }
      expect(errors).toEqual([]);
      await page.close();
    }
    expect(unexpected).toEqual([]);
  } finally { await browser?.close(); server?.stop(true); await rm(scratch,{recursive:true,force:true}); }
}, 60000);
