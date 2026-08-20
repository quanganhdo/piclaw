import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { shouldShowComposeAgentAffordance } from "../../web/src/ui/compose-layout.js";

const chatCss = readFileSync(path.join(import.meta.dir, "../../web/static/classic/css/chat.css"), "utf8");
const responsiveCss = readFileSync(path.join(import.meta.dir, "../../web/static/classic/css/responsive.css"), "utf8");
const classicIndex = readFileSync(path.join(import.meta.dir, "../../web/static/classic/index.html"), "utf8");

test("shows compose agent affordance when the footer is wide enough", () => {
  expect(shouldShowComposeAgentAffordance({
    footerWidth: 760,
    visibleAgentCount: 2,
    hasContextIndicator: true,
  })).toBe(true);
});

test("hides compose agent affordance when the footer is too narrow", () => {
  expect(shouldShowComposeAgentAffordance({
    footerWidth: 540,
    visibleAgentCount: 2,
    hasContextIndicator: true,
  })).toBe(false);
});

test("hides compose agent affordance when there are no visible agents", () => {
  expect(shouldShowComposeAgentAffordance({
    footerWidth: 900,
    visibleAgentCount: 0,
    hasContextIndicator: true,
  })).toBe(false);
});

test("classic index contains one clean set of generated asset references", () => {
  expect(classicIndex).not.toContain("<<<<<<< ");
  expect(classicIndex).not.toContain("=======");
  expect(classicIndex).not.toContain(">>>>>>> ");
  expect(classicIndex.match(/static\/classic\/dist\/app\.bundle\.css/g)).toHaveLength(1);
  expect(classicIndex.match(/static\/classic\/dist\/app\.bundle\.js/g)).toHaveLength(1);
});

test("base compose layout reserves text space beneath the floating session switcher", () => {
  const textareaRule = chatCss.match(/\.compose-session-trigger-top \+ \.compose-input-main textarea\s*\{[^}]+\}/)?.[0] ?? "";

  expect(textareaRule).toContain("padding-right: max(calc(var(--spacing-xs) + 28px), min(44vw, 156px));");
});

test("mobile compose layout keeps the session switcher floated above the textarea", () => {
  const triggerRules = [...responsiveCss.matchAll(/\.compose-session-trigger-top\s*\{[^}]+\}/g)].map(([rule]) => rule);

  expect(triggerRules.length).toBeGreaterThanOrEqual(2);
  expect(responsiveCss).toContain(".compose-session-trigger-top + .compose-input-main textarea");
  expect(responsiveCss).toContain("position: absolute;");
  expect(responsiveCss).toContain("z-index: 7;");
  expect(responsiveCss).toContain("padding-right: max(calc(var(--spacing-xs) + 28px), min(44vw, 156px));");
  expect(triggerRules.every((rule) => !rule.includes("position: static;"))).toBe(true);
});
