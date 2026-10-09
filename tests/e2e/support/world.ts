import { test as base, expect, Page } from '@playwright/test';
import { bootstrapE2eAuth } from './auth';
import { requireDisposableTestTarget } from '../../../runtime/scripts/test-target.js';

function resolveInternalSecret(): string {
  return (process.env.PICLAW_E2E_INTERNAL_SECRET || '').trim();
}

async function ensureSeedTimelinePost(page: Page, baseURL: string): Promise<void> {
  const hasPost = await page.locator('[data-testid="post"], .post').first().isVisible({ timeout: 1000 }).catch(() => false);
  if (hasPost) return;

  const secret = resolveInternalSecret();
  if (!secret) return;

  await fetch(`${baseURL.replace(/\/+$/, '')}/internal/post`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'x-piclaw-internal-secret': secret,
    },
    body: JSON.stringify({
      content: 'E2E seed timeline post with https://example.com link',
    }),
  }).catch(() => null);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
}

/**
 * Custom test fixture that provides a page ready for interaction.
 *
 * If PICLAW_E2E_INTERNAL_SECRET is available, the
 * fixture obtains a short-lived E2E web session before navigation. This keeps
 * authenticated microVM instances usable without weakening normal login flows.
 * If no secret is provided, the fixture falls back to no-auth mode.
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page, request }, use, testInfo) => {
    const baseURL = requireDisposableTestTarget(process.env.PICLAW_E2E_URL);
    const auth = await base.step('fixture-auth', () => bootstrapE2eAuth(request, baseURL));
    if (auth.attempted && !auth.authenticated) {
      throw new Error(`E2E auth bootstrap failed${auth.status ? ` with HTTP ${auth.status}` : ''}${auth.error ? `: ${auth.error}` : ''}`);
    }
    if (auth.cookieHeader) {
      const match = auth.cookieHeader.match(/piclaw_session=([^;]+)/);
      if (match) {
        const url = new URL(baseURL);
        await page.context().addCookies([{ name: 'piclaw_session', value: match[1], domain: url.hostname, path: '/' }]);
      }
    }
    let target = baseURL;
    if (/us07-reconnection|us18-19-compaction-model/.test(testInfo.file)) {
      const name = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const created = await page.request.post(`${baseURL}/agent/root-session`, { data: { agent_name: name }, headers: { 'x-piclaw-internal-secret': resolveInternalSecret() }, timeout: 10_000 });
      if (created.status() !== 201) throw new Error(`Fixture session creation failed: ${created.status()}`);
      const record = await created.json() as { branch?: { chat_jid?: string } };
      if (!record.branch?.chat_jid) throw new Error('Fixture session identity missing');
      target = `${baseURL}/?chat_jid=${encodeURIComponent(record.branch.chat_jid)}`;
    }
    await page.addInitScript(() => {
      const Native = window.EventSource;
      (window as any).__e2eSse = { opens: 0, errors: 0, statuses: [], sources: [] };
      window.EventSource = class extends Native {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          (window as any).__e2eSse.sources = [this];
          this.addEventListener('open', () => { (window as any).__e2eSse.opens++; });
          this.addEventListener('error', () => { (window as any).__e2eSse.errors++; });
          this.addEventListener('agent_status', (event) => { const d = JSON.parse((event as MessageEvent).data); const a = (window as any).__e2eSse.statuses; a.push({ type: d.type, intent: d.intent_key, chat: d.chat_jid }); if (a.length > 32) a.shift(); });
        }
      };
    });
    const initialStatus = page.waitForResponse(r => r.url().includes('/agent/status?') && r.status() === 200, { timeout: 10_000 });
    await base.step('fixture-navigation-and-sse', async () => {
      await page.goto(target, { waitUntil: 'domcontentloaded' });
      await (await initialStatus).finished();
      await page.waitForFunction(() => (window as any).__e2eSse.opens > 0, undefined, { timeout: 10_000 });
    });
    // Wait for app shell to render — SSE keeps networkidle from resolving.
    await page.waitForSelector('.compose-box, .compose-editor, [data-testid="compose-box"]', { timeout: 60000 });
    if (target === baseURL) await ensureSeedTimelinePost(page, baseURL);
    await page.waitForFunction(() => document.readyState !== 'loading', undefined, { timeout: 5000 });
    await use(page);
  },
});

export { expect };
