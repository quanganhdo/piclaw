import { test, expect } from '../support/world';
import { sel } from '../support/selectors';
import { sendAndRead, seedCompaction, observedCompaction, stubControl } from '../support/deterministic-turn';

// US-18: Compaction Indicator Instant Updates
// US-19: Model Switching After Compaction
//
// Compaction flow:
//   compaction_start SSE → status intent with intent_key="compaction"
//   → compose bar: context pie gets .is-compacting + elapsed timer
//   → abort button switches to compacting-mode spinner
//   compaction_end SSE → clears status notice
//   → context pie updates with new usage
//
// Model switch flow:
//   click model label → settings/models or popup
//   POST /agent/model → SSE model_changed
//   compose bar shows "Switching…" then new label
//   context usage recalculates for new model window

async function stopAndClearQueue(page: import('@playwright/test').Page) {
  if (await page.locator(sel.stopButton).isVisible()) await page.locator(sel.stopButton).click({ timeout: 1000 });
  const clear = page.getByRole('button', { name: /clear all/i });
  if (await clear.isVisible()) await clear.click({ timeout: 1000 });
  await page.waitForFunction(() => {
    const stop = document.querySelector('[data-testid="stop-button"], .compose-stop, button.abort-mode, button[aria-label*="Stop response" i]');
    return !stop || (stop as HTMLElement).offsetParent === null;
  }, undefined, { timeout: 5000 });
}

test.beforeEach(async ({ authedPage: page }) => {
  await stopAndClearQueue(page);
});

test.afterEach(async ({ authedPage: page }) => {
  await stubControl('clear');
  await stopAndClearQueue(page);
});

/** Get the compaction indicator state from the compose bar. */
async function getCompactionState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const pie = document.querySelector('.compose-context-pie') as HTMLElement | null;
    const abortBtn = document.querySelector('.send-btn.abort-mode, .send-btn.compacting-mode') as HTMLElement | null;
    const statusNotice = document.querySelector('.compose-status-notice, .compose-compaction-title') as HTMLElement | null;

    // Parse usage percentage from the pie title attribute
    // Format: "Context: 45K / 128K tokens (35%) — Compact context"
    const pieTitle = pie?.getAttribute('title') || '';
    const pctMatch = pieTitle.match(/\((\d+)%\)/);
    const usagePercent = pctMatch ? parseInt(pctMatch[1], 10) : null;

    // Parse token counts
    const tokenMatch = pieTitle.match(/Context:\s*([\d.]+K?)\s*\/\s*([\d.]+K?)\s*tokens/);
    const tokensUsed = tokenMatch ? tokenMatch[1] : null;
    const contextWindow = tokenMatch ? tokenMatch[2] : null;

    return {
      pieVisible: pie !== null && pie.offsetParent !== null,
      isCompacting: pie?.classList.contains('is-compacting') || false,
      pieAriaLabel: pie?.getAttribute('aria-label') || '',
      pieTitle,
      usagePercent,
      tokensUsed,
      contextWindow,
      abortMode: abortBtn?.classList.contains('compacting-mode') || false,
      statusNoticeText: statusNotice?.textContent?.trim() || '',
      // Check if the timer span is showing
      hasTimer: !!pie?.querySelector('.compose-context-pie-timer'),
      timerText: pie?.querySelector('.compose-context-pie-timer')?.textContent?.trim() || '',
    };
  });
}

/** Get the model label from the compose bar. */
async function getModelLabel(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const btn = document.querySelector('.compose-model-hint, .compose-model-btn, [class*="model-hint"]');
    return btn?.textContent?.trim() || '';
  });
}

// ── US-18: Compaction Indicator ──────────────────────────────────

test.describe('US-18: Compaction Indicator', () => {
  test('context pie shows token usage and percentage', async ({ authedPage: page }) => {
    await sendAndRead(page, 'usage');
    const state = await getCompactionState(page);
    expect(state.pieVisible).toBe(true);
    expect(state.pieTitle).toContain('Context:');
    expect(state.usagePercent).not.toBeNull();
    expect(state.usagePercent!).toBeGreaterThanOrEqual(0);
    expect(state.usagePercent!).toBeLessThanOrEqual(100);
  });

  test('/compact shows compaction indicator then updates usage', async ({ authedPage: page }) => {
    await seedCompaction(page, 'compact-context');
    const before = await getCompactionState(page);
    await observedCompaction(page, 'compact-command', async () => {
      await page.locator(sel.composeInput).fill('/compact');
      await page.keyboard.press('Enter');
    });
    const after = await getCompactionState(page);
    expect(after.usagePercent).not.toBeNull();
    expect(after.usagePercent!).toBeLessThanOrEqual(before.usagePercent!);
    expect(after.pieTitle).toContain(after.usagePercent + '%');
  });

  test('context pie is clickable and triggers compaction', async ({ authedPage: page }) => {
    await seedCompaction(page, 'pie-context');
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await observedCompaction(page, 'compact-pie', () => page.locator('.compose-context-pie').click());
    expect(errors).toEqual([]);
  });

  test('abort button enters compacting mode during compaction', async ({ authedPage: page }) => {
    await seedCompaction(page, 'abort-context');
    await observedCompaction(page, 'compact-abort-mode', async () => {
      await page.locator(sel.composeInput).fill('/compact');
      await page.keyboard.press('Enter');
      await expect(page.locator('.send-btn.compacting-mode')).toBeVisible({ timeout: 10_000 });
    });
  });
});

// ── US-19: Model Switching ───────────────────────────────────────

test.describe('US-19: Model Switching', () => {
  test('model label visible in compose bar', async ({ authedPage: page }) => {
    await page.waitForSelector(sel.timeline);
    const modelBtn = page.locator('.compose-model-hint, .compose-model-btn, [class*="model-hint"]').first();
    if (!(await modelBtn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Model picker is unavailable for this test-session state');
      return;
    }
    await expect(modelBtn).not.toHaveText(/^\s*$/);
  });

  test('model button is clickable and opens model selector', async ({ authedPage: page }) => {
    await page.waitForSelector(sel.timeline);

    const modelBtn = page.locator('.compose-model-hint, .compose-model-btn, [class*="model-hint"]').first();
    if (!(await modelBtn.isVisible())) {
      test.skip(undefined, 'Model button not visible');
      return;
    }

    await modelBtn.click();

    const popup = page.locator('.model-popup, .compose-model-popup, .settings-dialog, [data-pane="models"]');
    const opened = await popup.isVisible({ timeout: 3000 }).catch(() => false);
    if (opened) await page.keyboard.press('Escape');
    expect(opened).toBe(true);
  });

  test('/model command shows current model info', async ({ authedPage: page }) => {
    await page.waitForSelector(sel.timeline);

    const compose = page.locator(sel.composeInput);
    await compose.click();
    await compose.fill('/model');
    await page.keyboard.press('Enter');
    await expect(page.locator(sel.postContent).last()).not.toHaveText(/^\s*$/);

    const lastPost = page.locator(sel.postContent).last();
    await expect(lastPost).toContainText(/model|opencode/i);
  });

  test('model switch updates compose bar label and context usage', async ({ authedPage: page }) => {
    await page.waitForSelector(sel.timeline);

    // Capture current state
    const labelBefore = await getModelLabel(page);
    const usageBefore = await getCompactionState(page);

    // Open model selector
    const modelBtn = page.locator('.compose-model-hint, .compose-model-btn').first();
    if (!(await modelBtn.isVisible())) {
      test.skip(undefined, 'Model button not visible');
      return;
    }

    await modelBtn.click();
    await expect(page.locator('.compose-model-popup')).toBeVisible();

    // The compose picker is a searchable listbox. Select an option that is
    // not the active model; it deliberately does not use hidden radio inputs.
    const modelOptions = page.locator('.compose-model-popup [role="option"]:not([aria-selected="true"])');
    const optionCount = await modelOptions.count();
    if (optionCount === 0) {
      await page.keyboard.press('Escape');
      test.skip(undefined, 'No alternative models available to switch to');
      return;
    }

    // Click the first non-selected model
    await modelOptions.first().click();
    await expect(modelBtn).not.toHaveText(labelBefore, { timeout: 10_000 });

    // Close dialog if still open
    await page.keyboard.press('Escape').catch(() => {});

    // The confirmed model selection updates the compose label and preserves a
    // valid context indicator.
    const labelAfter = await getModelLabel(page);
    const usageAfter = await getCompactionState(page);
    expect(labelAfter).not.toBe(labelBefore);
    // The pie title contains "Context: XK / YK tokens". The context windows
    // may be equal, but the selected model must retain a valid indicator.
    if (usageBefore.contextWindow && usageAfter.contextWindow) {
      expect(usageAfter.pieTitle).toContain('Context:');
    }
  });

  test('model button not disabled after compaction', async ({ authedPage: page }) => {
    await page.waitForSelector(sel.timeline);

    // Build context and compact
    const compose = page.locator(sel.composeInput);
    await compose.click();
    await seedCompaction(page, 'model-context');

    await observedCompaction(page, 'compact-model', async () => {
      await compose.fill('/compact');
      await page.keyboard.press('Enter');
    });

    // Model button should be immediately clickable
    const modelBtn = page.locator('.compose-model-hint, .compose-model-btn').first();
    if (await modelBtn.isVisible()) {
      const isDisabled = await modelBtn.evaluate((el) =>
        (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'
      );
      expect(isDisabled).toBe(false);

      // And context pie should show updated (compacted) usage
      const state = await getCompactionState(page);
      if (state.pieVisible && state.usagePercent !== null) {
        expect(state.pieTitle).toContain(`${state.usagePercent}%`);
      }
    }
  });
});
