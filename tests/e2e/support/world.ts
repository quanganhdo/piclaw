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
  authedPage: async ({ page, request }, use) => {
    const baseURL = requireDisposableTestTarget(process.env.PICLAW_E2E_URL);
    const auth = await bootstrapE2eAuth(request, baseURL);
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
    await page.goto(baseURL);
    await page.waitForLoadState('domcontentloaded');
    // Wait for app shell to render — SSE keeps networkidle from resolving.
    await page.waitForSelector('.compose-box, .compose-editor, [data-testid="compose-box"]', { timeout: 60000 });
    await ensureSeedTimelinePost(page, baseURL);
    await page.waitForTimeout(500); // short SSE settle time
    await use(page);
  },
});

export { expect };
