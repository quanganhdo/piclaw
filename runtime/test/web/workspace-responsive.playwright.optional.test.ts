import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = '';

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
  browser = await chromium.launch({ headless: true });
  const staticRoot = join(import.meta.dir, '../../web/static/classic');
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/') {
        return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"></head><body><div class="app-shell workspace-collapsed"><aside class="workspace-sidebar"></aside><div class="workspace-drawer-backdrop" aria-hidden="true"></div><button class="workspace-toggle-tab closed"></button><main class="container"></main><div class="workspace-splitter"></div></div><script>const shell=document.querySelector('.app-shell');const toggle=document.querySelector('.workspace-toggle-tab');const setOpen=(open)=>{shell.classList.toggle('workspace-collapsed',!open);toggle.classList.toggle('open',open);toggle.classList.toggle('closed',!open)};window.showWorkspace=()=>setOpen(true);document.querySelector('.workspace-drawer-backdrop').onclick=()=>setOpen(false);</script></body></html>`, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      try {
        const body = await readFile(join(staticRoot, url.pathname));
        return new Response(body, { headers: { 'content-type': 'text/css' } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  });
  baseUrl = server.url.href;
});

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  browser = null;
  server = null;
});

async function openPage(viewport: { width: number; height: number }): Promise<Page> {
  if (!browser) throw new Error('browser not started');
  const page = await browser.newPage({ viewport });
  await page.goto(baseUrl, { waitUntil: 'load' });
  return page;
}

async function workspaceLayout(page: Page) {
  return page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector(selector) as HTMLElement;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { display: style.display, position: style.position, width: rect.width, height: rect.height };
    };
    return {
      workspace: read('.workspace-sidebar'),
      backdrop: read('.workspace-drawer-backdrop'),
      toggle: read('.workspace-toggle-tab'),
      splitter: read('.workspace-splitter'),
    };
  });
}

optionalBrowserTest('Show workspace opens a dismissible drawer below the desktop breakpoint', async () => {
  for (const viewport of [{ width: 900, height: 700 }, { width: 1100, height: 1300 }]) {
    const page = await openPage(viewport);
    try {
      const initial = await workspaceLayout(page);
      expect(initial.workspace.display).toBe('none');
      expect(initial.backdrop.display).toBe('none');

      await page.evaluate(() => (window as any).showWorkspace());
      const open = await workspaceLayout(page);
      expect(open.workspace.display).toBe('flex');
      expect(open.workspace.position).toBe('absolute');
      expect(open.workspace.width).toBeGreaterThan(0);
      expect(open.workspace.width).toBeLessThan(viewport.width);
      expect(open.backdrop.display).toBe('block');
      expect(open.toggle.display).toBe('flex');
      expect(open.splitter.display).toBe('none');

      await page.locator('.workspace-drawer-backdrop').click({ position: { x: viewport.width - 8, y: 8 } });
      const closed = await workspaceLayout(page);
      expect(closed.workspace.display).toBe('none');
      expect(closed.backdrop.display).toBe('none');
    } finally {
      await page.close();
    }
  }
});

optionalBrowserTest('desktop landscape keeps the workspace in the flex layout', async () => {
  const page = await openPage({ width: 1100, height: 700 });
  try {
    await page.evaluate(() => (window as any).showWorkspace());
    const layout = await workspaceLayout(page);
    expect(layout.workspace.display).toBe('flex');
    expect(layout.workspace.position).toBe('static');
    expect(layout.backdrop.display).toBe('none');
    expect(layout.splitter.display).toBe('block');
  } finally {
    await page.close();
  }
});
