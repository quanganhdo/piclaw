import { expect } from "bun:test";
import type { Page } from "playwright";

/** Checks actual rendered chevrons against the central 36px divider grip. */
export async function expectDividerChevrons(page: Page, selector: string): Promise<void> {
  const viewport = page.viewportSize();
  for (const width of [viewport?.width ?? 820, 390]) {
    await page.setViewportSize({ width, height: viewport?.height ?? 900 });
    await expectGeometry(page, selector);
  }
  if (viewport) await page.setViewportSize(viewport);
}

async function expectGeometry(page: Page, selector: string): Promise<void> {
  const geometry = await page.locator(selector).evaluate((root) => {
    const box = root.getBoundingClientRect();
    const arrows = [...root.querySelectorAll<HTMLElement>(".compose-latest-chevron")].map((arrow) => {
      const rect = arrow.getBoundingClientRect(), style = getComputedStyle(arrow);
      return { left: rect.left, right: rect.right, width: rect.width, visible: style.display !== "none", stroke: parseFloat(style.borderRightWidth), pointerEvents: style.pointerEvents, hidden: arrow.getAttribute("aria-hidden") };
    });
    return { center: box.left + box.width / 2, arrows };
  });
  expect(geometry.arrows).toHaveLength(2);
  const [left, right] = geometry.arrows;
  for (const arrow of geometry.arrows) {
    expect(arrow.visible).toBe(true);
    expect(arrow.width).toBeGreaterThan(12);
    expect(arrow.stroke).toBe(3);
    expect(arrow.pointerEvents).toBe("none");
    expect(arrow.hidden).toBe("true");
  }
  expect(geometry.center - 18 - left.right).toBeGreaterThan(6);
  expect(right.left - (geometry.center + 18)).toBeGreaterThan(6);
  expect(Math.abs((geometry.center - (left.left + left.right) / 2) - ((right.left + right.right) / 2 - geometry.center))).toBeLessThan(1);
}
