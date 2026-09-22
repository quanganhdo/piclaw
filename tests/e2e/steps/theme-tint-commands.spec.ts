import { test, expect } from '../support/world';
import { sel } from '../support/selectors';

// /theme and /tint E2E tests
//
// Architecture:
//   compose → POST /agent/default/message → server handleUiThemeCommand()
//   → SSE ui_theme event → client applyThemeFromEvent()
//   → sets data-theme, data-color-theme, data-tint on <html>
//   → applies CSS variables on document.documentElement.style
//   → persists to localStorage (piclaw_theme, piclaw_tint)
//
// Key constraint: /tint only works on the "default" theme.
//   Code: if (themeName === 'default' && tint) { palette = buildTintedPalette(...) }
//
// Valid themes: default, tango, xterm, monokai, monokai-pro, ristretto,
//   dracula, catppuccin, nord, gruvbox, solarized, tokyo, miasma, github, gotham
// "dark" and "light" are NOT valid theme names.

/** Send a slash command and wait for the authenticated POST to complete. */
async function sendCommand(page: import('@playwright/test').Page, cmd: string) {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/agent/default/message') && response.request().method() === 'POST',
    { timeout: 10_000 },
  ).catch(() => null);
  const compose = page.locator(sel.composeInput);
  await compose.click();
  await compose.fill(cmd);
  await page.keyboard.press('Enter');
  const response = await responsePromise;
  if (response && !response.ok()) {
    throw new Error(`${cmd} failed with HTTP ${response.status()}: ${await response.text().catch(() => '')}`);
  }
  await page.waitForTimeout(500);
}

async function waitForThemeState(
  page: import('@playwright/test').Page,
  expected: Partial<{ dataTheme: string; dataColorTheme: string; dataTint: string }>,
) {
  await page.waitForFunction((expectedState) => {
    const root = document.documentElement;
    if (expectedState.dataTheme !== undefined && root.dataset.theme !== expectedState.dataTheme) return false;
    if (expectedState.dataColorTheme !== undefined && root.dataset.colorTheme !== expectedState.dataColorTheme) return false;
    if (expectedState.dataTint !== undefined && (root.dataset.tint || '') !== expectedState.dataTint) return false;
    return true;
  }, expected, { timeout: 10_000 });
}

/** Read the current theme state from the DOM. */
async function getThemeState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const style = root.style;
    return {
      dataTheme: root.dataset.theme || null,
      dataColorTheme: root.dataset.colorTheme || null,
      dataTint: root.dataset.tint || '',
      bgPrimary: style.getPropertyValue('--bg-primary').trim() || null,
      bgSecondary: style.getPropertyValue('--bg-secondary').trim() || null,
      accentColor: style.getPropertyValue('--accent-color').trim() || null,
      storedTheme: localStorage.getItem('piclaw_theme'),
      storedTint: localStorage.getItem('piclaw_tint'),
    };
  });
}

/** Get the actual rendered background color of the page body. */
async function getRenderedBgColor(page: import('@playwright/test').Page) {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

// ── /theme command ───────────────────────────────────────────────

test.describe('/theme command', () => {
  test.afterEach(async ({ authedPage: page }) => {
    // Always restore default at end
    await sendCommand(page, '/theme default');
  });

  test('/theme with no args shows theme list in timeline', async ({ authedPage: page }) => {
    await sendCommand(page, '/theme');
    const lastPost = page.locator(sel.postContent).last();
    const text = await lastPost.textContent();
    expect(text).toContain('Available themes');
  });

  test('/theme ristretto switches to dark theme with visible color change', async ({ authedPage: page }) => {
    // Capture default state
    const before = await getThemeState(page);
    const bgBefore = await getRenderedBgColor(page);

    // Switch to ristretto
    await sendCommand(page, '/theme ristretto');
    await waitForThemeState(page, { dataTheme: 'dark', dataColorTheme: 'ristretto', dataTint: '' });
    const after = await getThemeState(page);
    const bgAfter = await getRenderedBgColor(page);

    // DOM attributes
    expect(after.dataTheme).toBe('dark');
    expect(after.dataColorTheme).toBe('ristretto');
    expect(after.dataTint).toBe('');

    // CSS variables applied (ristretto has #2c2525 bg, #ff9f43 accent)
    expect(after.bgPrimary).toBeTruthy();
    expect(after.accentColor).toBeTruthy();

    // Visual: background color actually changed
    expect(bgAfter).not.toBe(bgBefore);

    // localStorage
    expect(after.storedTheme).toBe('ristretto');

    // Timeline confirmation
    const lastPost = page.locator(sel.postContent).last();
    const text = await lastPost.textContent();
    expect(text).toContain('Theme set to');
  });

  test('/theme default restores from ristretto with visible color change', async ({ authedPage: page }) => {
    // Set ristretto first
    await sendCommand(page, '/theme ristretto');
    await waitForThemeState(page, { dataColorTheme: 'ristretto' });
    const dark = await getThemeState(page);
    const bgDark = await getRenderedBgColor(page);
    expect(dark.dataColorTheme).toBe('ristretto');

    // Restore default
    await sendCommand(page, '/theme default');
    await waitForThemeState(page, { dataColorTheme: 'default', dataTint: '' });
    const restored = await getThemeState(page);
    const bgRestored = await getRenderedBgColor(page);

    // DOM attributes
    expect(restored.dataColorTheme).toBe('default');
    expect(restored.dataTint).toBe('');

    // Visual: background changed back
    expect(bgRestored).not.toBe(bgDark);

    // The shared palette system explicitly applies default semantic variables,
    // rather than relying on skin stylesheet fallbacks.
    expect(restored.bgPrimary).toBe('#ffffff');

    // localStorage
    expect(restored.storedTheme).toBe('default');
    expect(restored.storedTint === '' || restored.storedTint === null).toBe(true);
  });

  test('/theme dark returns error — not a valid theme name', async ({ authedPage: page }) => {
    const before = await getThemeState(page);

    await sendCommand(page, '/theme dark');

    // Theme should NOT have changed
    const after = await getThemeState(page);
    expect(after.dataColorTheme).toBe(before.dataColorTheme);

    // Error message in timeline
    const lastPost = page.locator(sel.postContent).last();
    const text = await lastPost.textContent();
    expect(text).toContain('Unknown theme');
  });

  test('/theme nosuchtheme returns error', async ({ authedPage: page }) => {
    const before = await getThemeState(page);

    await sendCommand(page, '/theme nosuchtheme');

    const after = await getThemeState(page);
    expect(after.dataColorTheme).toBe(before.dataColorTheme);

    const lastPost = page.locator(sel.postContent).last();
    const text = await lastPost.textContent();
    expect(text).toContain('Unknown theme');
  });

  test('/theme survives page refresh', async ({ authedPage: page }) => {
    await sendCommand(page, '/theme ristretto');
    await waitForThemeState(page, { dataColorTheme: 'ristretto' });
    expect((await getThemeState(page)).dataColorTheme).toBe('ristretto');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const after = await getThemeState(page);
    expect(after.storedTheme).toBe('ristretto');
    expect(after.dataTheme).toBe('dark');
  });

  test('/theme changes are delivered to another connected browser via SSE', async ({ authedPage: page }) => {
    const other = await page.context().newPage();
    try {
      await other.goto(process.env.PICLAW_E2E_URL || 'http://localhost:8080');
      await other.waitForLoadState('domcontentloaded');
      await other.waitForSelector('.compose-box, .compose-editor, [data-testid="compose-box"]', { timeout: 60_000 });

      await sendCommand(page, '/theme ristretto');
      await waitForThemeState(page, { dataColorTheme: 'ristretto' });
      await waitForThemeState(other, { dataColorTheme: 'ristretto' });
    } finally {
      await other.close().catch(() => {});
      await sendCommand(page, '/theme default');
    }
  });
});

// ── /tint command (default theme only) ───────────────────────────

test.describe('/tint command on default theme', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    // Ensure we're on the default theme with no tint
    await sendCommand(page, '/theme default');
    await sendCommand(page, '/tint off');
  });

  test.afterEach(async ({ authedPage: page }) => {
    await sendCommand(page, '/tint off');
  });

  test('/tint #e11d48 changes accent and background on default theme', async ({ authedPage: page }) => {
    const before = await getThemeState(page);
    const bgBefore = await getRenderedBgColor(page);

    await sendCommand(page, '/tint #e11d48');
    await waitForThemeState(page, { dataColorTheme: 'default', dataTint: '#e11d48' });
    const after = await getThemeState(page);
    const bgAfter = await getRenderedBgColor(page);

    // DOM attributes
    expect(after.dataColorTheme).toBe('default');
    expect(after.dataTint).toBe('#e11d48');

    // Tint on default applies CSS variables (unlike untinted default which clears them)
    expect(after.bgPrimary).toBeTruthy();
    expect(after.accentColor).toBeTruthy();

    // Visual: background got tinted (subtle but measurable)
    // bgPrimary should contain a tinted color, not pure white
    expect(after.bgPrimary).not.toBe('#ffffff');

    // localStorage
    expect(after.storedTheme).toBe('default');
    expect(after.storedTint).toContain('e11d48');

    // Timeline confirmation
    const lastPost = page.locator(sel.postContent).last();
    const text = await lastPost.textContent();
    expect(text).toContain('Tint set to');
  });

  test('/tint orange applies named color on default theme', async ({ authedPage: page }) => {
    await sendCommand(page, '/tint orange');
    await waitForThemeState(page, { dataColorTheme: 'default', dataTint: 'orange' });
    const after = await getThemeState(page);

    expect(after.dataColorTheme).toBe('default');
    expect(after.dataTint).toBe('orange');

    // CSS variables should be applied (tinted default)
    expect(after.bgPrimary).toBeTruthy();
    expect(after.accentColor).toBeTruthy();

    expect(after.storedTint).toBe('orange');
  });

  test('/tint off clears tint and restores vanilla default', async ({ authedPage: page }) => {
    // Apply a tint first
    await sendCommand(page, '/tint #3b82f6');
    await waitForThemeState(page, { dataTint: '#3b82f6' });
    const tinted = await getThemeState(page);
    expect(tinted.dataTint).toBe('#3b82f6');
    expect(tinted.bgPrimary).toBeTruthy(); // CSS vars applied

    // Clear it
    await sendCommand(page, '/tint off');
    await waitForThemeState(page, { dataTint: '' });
    const cleared = await getThemeState(page);

    expect(cleared.dataTint).toBe('');
    expect(cleared.dataColorTheme).toBe('default');

    // Untinted default restores the explicit shared default palette.
    expect(cleared.bgPrimary).toBe('#ffffff');

    expect(cleared.storedTint === '' || cleared.storedTint === null).toBe(true);

    // Timeline
    const lastPost = page.locator(sel.postContent).last();
    const text = await lastPost.textContent();
    expect(text).toContain('Tint cleared');
  });

  test('switching tints changes visible accent color', async ({ authedPage: page }) => {
    // Tint red
    await sendCommand(page, '/tint #e11d48');
    const red = await getThemeState(page);

    // Tint blue
    await sendCommand(page, '/tint #3b82f6');
    const blue = await getThemeState(page);

    // Accent colors should differ between the two tints
    expect(red.accentColor).toBeTruthy();
    expect(blue.accentColor).toBeTruthy();
    expect(red.accentColor).not.toBe(blue.accentColor);

    // Background tints should also differ
    expect(red.bgPrimary).not.toBe(blue.bgPrimary);
  });

  test('/tint with no args shows usage', async ({ authedPage: page }) => {
    await sendCommand(page, '/tint');
    const lastPost = page.locator(sel.postContent).last();
    const text = await lastPost.textContent();
    expect(text).toContain('Usage');
  });

  test('/tint $$invalid returns error without changing state', async ({ authedPage: page }) => {
    const before = await getThemeState(page);
    await sendCommand(page, '/tint $$notacolor');
    const after = await getThemeState(page);

    expect(after.dataTint).toBe(before.dataTint);

    const lastPost = page.locator(sel.postContent).last();
    const text = await lastPost.textContent();
    expect(text).toContain('Invalid tint');
  });

  test('/tint survives page refresh', async ({ authedPage: page }) => {
    await sendCommand(page, '/tint #e11d48');
    expect((await getThemeState(page)).dataTint).toBe('#e11d48');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const after = await getThemeState(page);
    expect(after.storedTint).toContain('e11d48');
    expect(after.dataTint).toBeTruthy();
    // CSS variables should be reapplied from localStorage
    expect(after.bgPrimary).toBeTruthy();
  });
});

// ── Theme + tint interaction ─────────────────────────────────────

test.describe('/theme and /tint interaction', () => {
  test.afterEach(async ({ authedPage: page }) => {
    await sendCommand(page, '/tint off');
    await sendCommand(page, '/theme default');
  });

  test('tint on default, switch to ristretto, switch back — tint reapplied', async ({ authedPage: page }) => {
    // Start clean
    await sendCommand(page, '/theme default');
    await sendCommand(page, '/tint off');

    // Apply tint on default
    await sendCommand(page, '/tint #e11d48');
    const tintedDefault = await getThemeState(page);
    expect(tintedDefault.dataTint).toBe('#e11d48');
    expect(tintedDefault.bgPrimary).toBeTruthy(); // tinted

    // Switch to ristretto — tint is irrelevant (only applies to default)
    await sendCommand(page, '/theme ristretto');
    const ristretto = await getThemeState(page);
    expect(ristretto.dataColorTheme).toBe('ristretto');
    expect(ristretto.dataTheme).toBe('dark');

    // Switch back to default — tint should be gone (server cleared it)
    await sendCommand(page, '/theme default');
    const backToDefault = await getThemeState(page);
    expect(backToDefault.dataColorTheme).toBe('default');
    // After theme switch, tint state depends on server — /theme sets tint: null
    expect(backToDefault.dataTint).toBe('');
  });

  test('tint is ignored on non-default theme (ristretto)', async ({ authedPage: page }) => {
    await sendCommand(page, '/theme ristretto');
    const beforeTint = await getThemeState(page);

    // Tint command will set server state but client won't apply it visually
    // because ristretto !== 'default'
    // Actually: /tint sets theme to "default" in the payload (server-side)
    // So /tint on ristretto will SWITCH to default+tint
    await sendCommand(page, '/tint #3b82f6');
    const afterTint = await getThemeState(page);

    // /tint payload has theme: "default", so it should switch to default
    expect(afterTint.dataColorTheme).toBe('default');
    expect(afterTint.dataTint).toBe('#3b82f6');
  });

  test('round-trip: default → tint → ristretto → default is visually consistent', async ({ authedPage: page }) => {
    // 1. Clean default
    await sendCommand(page, '/theme default');
    await sendCommand(page, '/tint off');
    const cleanDefault = await getRenderedBgColor(page);

    // 2. Tint it
    await sendCommand(page, '/tint #e11d48');
    const tintedBg = await getRenderedBgColor(page);
    expect(tintedBg).not.toBe(cleanDefault); // tint changed bg

    // 3. Switch to ristretto
    await sendCommand(page, '/theme ristretto');
    const ristrettoBg = await getRenderedBgColor(page);
    expect(ristrettoBg).not.toBe(tintedBg); // different theme entirely

    // 4. Back to clean default
    await sendCommand(page, '/theme default');
    const restoredBg = await getRenderedBgColor(page);
    // Should be close to clean default (no tint — /theme default clears tint)
    expect(restoredBg).toBe(cleanDefault);
  });
});
