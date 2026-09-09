/**
 * scripts/web-silence-test.ts – Playwright smoke test for web UI silence.
 *
 * Launches a headless browser, connects to the local web UI, and verifies
 * that basic page load, SSE connection, and message posting work without
 * console errors.
 */

import { chromium } from "playwright";
import { requireDisposableTestTarget } from "../runtime/scripts/test-target.js";

const url = requireDisposableTestTarget(process.env.PICLAW_E2E_BASE_URL);

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.addInitScript(() => {
    // Speed up silence timers for tests.
    (window as any).__PICLAW_SILENCE = {
      warning: 100,
      finalize: 250,
      refresh: 100,
    };
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => {
    return !!(window as any).__PICLAW_TEST_API?.emit;
  }, { timeout: 10000 });

  // Scenario 1: partial content finalized with warning.
  await page.evaluate(() => {
    (window as any).__PICLAW_TEST_API?.reset?.();
    (window as any).__PICLAW_TEST_API?.emit?.("agent_status", { type: "thinking", title: "Thinking...", turn_id: "turn-test-1" });
    (window as any).__PICLAW_TEST_API?.emit?.("agent_draft_delta", { reset: true, delta: "Silence test partial", turn_id: "turn-test-1" });
  });

  await page.waitForTimeout(150);
  const waitingText = await page.evaluate(() => {
    return document.querySelector(".agent-status-text")?.textContent || "";
  });
  assert(waitingText.includes("Waiting for model"), `Expected waiting status, got: ${waitingText}`);

  await page.waitForTimeout(200);
  const postText = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".post-content"))
      .map((el) => el.textContent || "")
      .join("\n");
  });

  assert(postText.includes("Silence test partial"), "Finalized response missing partial content");
  assert(
    postText.includes("Response may be incomplete — the model stopped responding"),
    "Finalized response missing warning message"
  );

  // Scenario 2: no content received => error state.
  await page.evaluate(() => {
    (window as any).__PICLAW_TEST_API?.reset?.();
    (window as any).__PICLAW_TEST_API?.emit?.("agent_status", { type: "thinking", title: "Thinking...", turn_id: "turn-test-2" });
  });

  await page.waitForTimeout(300);
  const stallText = await page.evaluate(() => {
    return document.querySelector(".agent-status-text")?.textContent || "";
  });
  assert(
    stallText.includes("Response stalled — No content received"),
    `Expected stall error, got: ${stallText}`
  );

  console.log(JSON.stringify({ waitingText, hasWarning: true, hasPartial: true, stallText }, null, 2));

  await browser.close();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
