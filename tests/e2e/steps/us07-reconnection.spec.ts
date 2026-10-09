import { test, expect } from '../support/world';
import { sel } from '../support/selectors';
import { sendAndRead, stubControl, waitStubStarted } from '../support/deterministic-turn';

async function disconnect(page: import('@playwright/test').Page) {
  const errors = await page.evaluate(() => (window as any).__e2eSse.errors);
  await page.context().setOffline(true);
  // Chromium's offline switch may leave an established stream open. Inject
  // the transport failure, then exercise the application's real reconnect.
  await page.evaluate(() => { const source = (window as any).__e2eSse.sources.at(-1) as EventSource; source.close(); source.dispatchEvent(new Event('error')); });
  await page.waitForFunction(before => (window as any).__e2eSse.errors > before, errors, { timeout: 10_000 });
}
async function reconnect(page: import('@playwright/test').Page) {
  const opens = await page.evaluate(() => (window as any).__e2eSse.opens);
  await page.context().setOffline(false);
  await page.waitForFunction(before => (window as any).__e2eSse.opens > before, opens, { timeout: 10_000 });
  await expect(page.locator(sel.composeInput)).toBeEditable();
}

test.afterEach(async ({ authedPage: page }) => {
  await page.context().setOffline(false);
  await stubControl('clear');
});

test.describe('US-07: SSE Reconnection', () => {
  test('SSE reconnects after network drop', async ({ authedPage: page }) => {
    await disconnect(page);
    await reconnect(page);
    await sendAndRead(page, 'after-network-drop', 'Say hello');
  });

  test('messages delivered during disconnect appear after reconnect', async ({ authedPage: page }) => {
    await stubControl('hold', 'disconnected-response');
    await page.locator(sel.composeInput).fill('[e2e-id:disconnected-response] Say hello');
    await page.keyboard.press('Enter');
    await waitStubStarted('disconnected-response');
    await disconnect(page);
    await stubControl('release', 'disconnected-response');
    const chat = new URL(page.url()).searchParams.get('chat_jid')!;
    await expect.poll(async () => {
      const response = await fetch(`${process.env.PICLAW_E2E_URL}/timeline?limit=100&chat_jid=${encodeURIComponent(chat)}`, { headers: { 'x-piclaw-internal-secret': process.env.PICLAW_E2E_INTERNAL_SECRET! }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Fixture timeline read failed: ${response.status}`);
      const body = await response.json() as { posts?: Array<{ data?: { content?: string; type?: string } }> };
      return body.posts?.filter(post => post.data?.type === 'agent_response' && String(post.data?.content).includes('E2E response disconnected-response.')).length || 0;
    }, { timeout: 15_000 }).toBe(1);
    await reconnect(page);
    await expect(page.locator(sel.postContent).filter({ hasText: 'E2E response disconnected-response.' })).toHaveCount(1, { timeout: 15_000 });
  });

  test('no auto-reload loop on version drift', async ({ authedPage: page }) => {
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    const identity = await page.evaluate(() => { (window as any).__e2eDocumentIdentity = 'same-document'; return location.href; });
    await page.evaluate(() => { const source = (window as any).__e2eSse.sources.at(-1) as EventSource; source.dispatchEvent(new MessageEvent('connected', { data: JSON.stringify({ app_asset_version: 'e2e-new-version' }) })); });
    await expect(page.getByText('New UI available', { exact: true })).toBeVisible();
    await sendAndRead(page, 'after-version-drift');
    expect(navigations).toBe(0);
    expect(page.url()).toBe(identity);
    expect(await page.evaluate(() => (window as any).__e2eDocumentIdentity)).toBe('same-document');
  });

  test('agent status correct after reconnect', async ({ authedPage: page }) => {
    await disconnect(page);
    await reconnect(page);
    await sendAndRead(page, 'status-after-reconnect');
    await expect(page.locator(sel.stopButton)).not.toBeVisible();
  });

  test('page refresh recovers all state', async ({ authedPage: page }) => {
    await sendAndRead(page, 'retained-on-refresh');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(sel.postContent).filter({ hasText: 'E2E response retained-on-refresh.' })).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator(sel.composeInput)).toBeEditable();
  });

  test('queue state refreshes after reconnect', async ({ authedPage: page }) => {
    await stubControl('hold', 'queue-first');
    await page.locator(sel.composeInput).fill('[e2e-id:queue-first] First queued test turn');
    await page.keyboard.press('Enter');
    await waitStubStarted('queue-first');
    await expect(page.locator(sel.stopButton)).toBeVisible();
    await page.locator(sel.composeInput).fill('[e2e-id:queue-second] Named queued follow-up');
    await page.keyboard.press('Enter');
    await expect(page.locator(sel.queueItem).filter({ hasText: 'Named queued follow-up' })).toHaveCount(1, { timeout: 10_000 });
    await disconnect(page);
    await reconnect(page);
    await expect(page.locator(sel.queueItem).filter({ hasText: 'Named queued follow-up' })).toHaveCount(1);
    await stubControl('release', 'queue-first');
    await expect(page.locator(sel.postContent).filter({ hasText: 'E2E response queue-first.' })).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(sel.postContent).filter({ hasText: 'E2E response queue-second.' })).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(sel.queueItem).filter({ hasText: 'Named queued follow-up' })).toHaveCount(0);
  });
});
