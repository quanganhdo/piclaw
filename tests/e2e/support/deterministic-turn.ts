import { test, expect, type Page } from '@playwright/test';
import { sel } from './selectors';

function controlUrl(): string {
  const base = process.env.OPENCODE_BASE_URL;
  if (!base || process.env.PICLAW_E2E_DISPOSABLE !== '1') throw new Error('Explicit disposable loopback model stub required');
  const url = new URL(base);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Loopback model stub required');
  return `${url.origin}/__test/control`;
}
export async function stubControl(action: 'hold' | 'release' | 'clear', id = '') {
  const r = await fetch(controlUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, id }), signal: AbortSignal.timeout(5000) });
  if (!r.ok || !(await r.json() as { ok: boolean }).ok) throw new Error(`Stub control refused ${action}`);
}
export async function waitStubStarted(id: string) {
  await expect.poll(async () => {
    const r = await fetch(`${controlUrl()}?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(5000) });
    return (await r.json() as { started: boolean }).started;
  }, { timeout: 10_000 }).toBe(true);
}
export async function sendAndRead(page: Page, id: string, text = 'Known short context. '.repeat(80)) {
  const accepted = page.waitForResponse(r => r.request().method() === 'POST' && /\/agent\/[^/]+\/message(?:\?|$)/.test(r.url()), { timeout: 10_000 });
  await test.step('request-accepted', async () => {
    await page.locator(sel.composeInput).fill(`[e2e-id:${id}] ${text}`);
    await page.keyboard.press('Enter');
    expect((await accepted).status()).toBe(201);
  });
  await test.step('response-delivered', async () => {
    await expect(page.locator(sel.postContent).filter({ hasText: `E2E response ${id}.` })).toHaveCount(1, { timeout: 15_000 });
  });
  await expect(page.locator(sel.stopButton)).not.toBeVisible({ timeout: 10_000 });
  const chat = new URL(page.url()).searchParams.get('chat_jid') || 'web:default';
  await expect.poll(async () => {
    const r = await page.request.get(`/agent/status?chat_jid=${encodeURIComponent(chat)}&ui=1`, { timeout: 5000 });
    const state = await r.json() as { status?: { status?: string } };
    if (r.status() !== 200 || !state.status?.status) throw new Error('Fixture status unavailable');
    return state.status.status;
  }, { timeout: 10_000 }).not.toBe('active');
}
export async function seedCompaction(page: Page, id: string) {
  for (let i = 0; i < 3; i++) await sendAndRead(page, `${id}-${i}`);
  const snapshot = page.waitForResponse(r => r.url().includes('/agent/status?') && r.status() === 200, { timeout: 10_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await (await snapshot).finished();
  await page.waitForFunction(() => (window as any).__e2eSse.opens > 0, undefined, { timeout: 10_000 });
  await expect(page.locator('.compose-context-pie')).toBeVisible();
}
export async function observedCompaction(page: Page, id: string, trigger: () => Promise<void>) {
  await stubControl('hold', id);
  try {
    await test.step('compaction-start', async () => {
      await trigger();
      await expect(page.locator('.compose-context-pie')).toHaveClass(/is-compacting/, { timeout: 10_000 });
      await waitStubStarted(id);
      await expect(page.locator('.compose-context-pie-timer')).toBeVisible();
    });
    await test.step('compaction-end', async () => {
      await stubControl('release', id);
      await expect(page.locator('.compose-context-pie')).not.toHaveClass(/is-compacting/, { timeout: 15_000 });
    });
    await expect(page.locator('.compose-context-pie-timer')).toHaveCount(0);
    await expect(page.locator('.send-btn.compacting-mode')).toHaveCount(0);
    await expect(page.locator(sel.postContent).last()).toContainText(/compact/i);
    await expect(page.locator(sel.postContent).last()).not.toContainText(/invalid|Nothing to compact|still exceeds model context|failed/i);
  } finally { await stubControl('release', id); }
}
