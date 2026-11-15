import { test, expect } from '../support/world';
import { sel } from '../support/selectors';

// US-30: Settings — Compaction and Context Mode Controls
//
// Commits:
// - 30c304392: feat(settings): add compaction and context mode settings pane controls
// - 8801a5b7d: Implement scoped enabled model handling

test.describe('US-30: Compaction Settings Pane', () => {
  test('settings has compaction/context controls', async ({ authedPage: page }) => {
    await page.waitForSelector(sel.timeline);

    // Open settings
    await page.keyboard.press('Meta+Comma');
    await page.waitForSelector(sel.settingsDialog, { timeout: 5000 });

    // Navigate to compaction pane (may be under General or its own tab)
    const settingsText = await page.locator(sel.settingsDialog).textContent() || '';

    // Look for compaction-related controls
    const hasCompactionControls =
      settingsText.includes('compaction') ||
      settingsText.includes('Compaction') ||
      settingsText.includes('context mode') ||
      settingsText.includes('Context mode');

    // If not on current pane, try navigating
    if (!hasCompactionControls) {
      const navItems = page.locator(`${sel.settingsNav} button, ${sel.settingsNav} [role="tab"]`);
      const count = await navItems.count();
      for (let i = 0; i < count; i++) {
        const text = await navItems.nth(i).textContent();
        if (text?.toLowerCase().includes('compact') || text?.toLowerCase().includes('context') || text?.toLowerCase().includes('agent')) {
          await navItems.nth(i).click();
          await page.waitForTimeout(500);
          break;
        }
      }
    }

    // Should have native compaction or independent context controls
    const paneText = await page.locator(sel.settingsPane + ', .settings-content').textContent() || '';
    const found = paneText.includes('compaction') || paneText.includes('Compaction') ||
                  paneText.includes('context') || paneText.includes('Context');
    expect(found).toBe(true);

    await page.keyboard.press('Escape');
  });

  // Native auto-toggle keyboard/save coverage lives in the isolated two-skin
  // settings-row-alignment fixture; the legacy processing-method story is retired.

  test('model scope filter available in settings', async ({ authedPage: page }) => {
    await page.waitForSelector(sel.timeline);

    await page.keyboard.press('Meta+Comma');
    await page.waitForSelector(sel.settingsDialog, { timeout: 5000 });

    // Navigate to models pane
    const modelsNav = page.locator(`${sel.settingsNav} :text("Models"), ${sel.settingsNav} [data-nav="models"]`);
    if (await modelsNav.isVisible()) {
      await modelsNav.click();
      await page.waitForTimeout(500);
    }

    // Should have some model-related content
    const paneText = await page.locator(sel.settingsPane + ', .settings-content').textContent() || '';
    const hasModels = paneText.includes('model') || paneText.includes('Model') || paneText.includes('provider');
    expect(hasModels).toBe(true);

    await page.keyboard.press('Escape');
  });
});
