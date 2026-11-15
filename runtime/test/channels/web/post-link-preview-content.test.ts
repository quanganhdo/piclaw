/**
 * test/channels/web/post-link-preview-content.test.ts
 *
 * Regression test: message text must remain unchanged when OpenGraph link
 * previews exist. We render preview cards in addition to user text, not instead
 * of URL text.
 */

import { expect, test } from "bun:test";
import "../../helpers.js";
import { buildLinkPreviewBackgroundStyle, extractRecoveryMarkerBlocks, extractTimeoutMarkerBlocks, formatRecoveryChipTooltip, formatTimeoutChipTooltip, getDisplayContent } from "../../../web/src/components/post.ts";

test("getDisplayContent keeps URL text when previews are present", () => {
  const content = "Check this out: https://example.com/article";
  const previews = [
    {
      url: "https://example.com/article",
      title: "Example Article",
    },
  ];

  expect(getDisplayContent(content, previews)).toBe(content);
});

test("getDisplayContent preserves exact formatting (no trim/removal)", () => {
  const content = "https://example.com   \n\n";
  const previews = [{ url: "https://example.com" }];

  expect(getDisplayContent(content, previews)).toBe(content);
});

test("getDisplayContent returns empty string for non-string content", () => {
  expect(getDisplayContent(null as any, [])).toBe("");
  expect(getDisplayContent(undefined as any, [])).toBe("");
});

test("buildLinkPreviewBackgroundStyle keeps image URLs confined to backgroundImage", () => {
  const style = buildLinkPreviewBackgroundStyle("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>');color:red;/*");

  expect(style).toEqual({
    backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>');color:red;/*")`,
  });

  if (typeof document !== "undefined") {
    const node = document.createElement("a");
    for (const [name, value] of Object.entries(style || {})) {
      (node.style as any)[name] = value;
    }
    expect(node.style.color).toBe("");
  }
});

test("extractRecoveryMarkerBlocks keeps only recovered recovery markers", () => {
  expect(extractRecoveryMarkerBlocks([
    { type: "recovery_marker", recovered: true, attempts_used: 2 },
    { type: "recovery_marker", recovered: false, attempts_used: 1 },
    { type: "text", text: "hello" },
  ])).toEqual([
    { type: "recovery_marker", recovered: true, attempts_used: 2 },
  ]);
});

test("formatRecoveryChipTooltip describes attempts and classifier", () => {
  expect(formatRecoveryChipTooltip({ attempts_used: 1, classifier: "context_recover" })).toBe("Recovered automatically — context limit exceeded");
  expect(formatRecoveryChipTooltip({ attempts_used: 3, classifier: "api_error" })).toBe("Recovered after 3 attempts — API error");
  expect(formatRecoveryChipTooltip({ attempts_used: 2, classifier: "custom_classifier" })).toBe("Recovered after 2 attempts — custom classifier");
});

test("extractTimeoutMarkerBlocks keeps only timeout markers", () => {
  expect(extractTimeoutMarkerBlocks([
    { type: "timeout_marker", timed_out: true, tool_action_summary: "Timed out while running bash" },
    { type: "timeout_marker", timed_out: false },
    { type: "text", text: "hello" },
  ])).toEqual([
    { type: "timeout_marker", timed_out: true, tool_action_summary: "Timed out while running bash" },
  ]);
});

test("formatTimeoutChipTooltip describes the last timed-out tool action", () => {
  expect(formatTimeoutChipTooltip({ tool_action_summary: "Timed out while running bash" })).toBe("Turn timed out — Timed out while running bash");
  expect(formatTimeoutChipTooltip({})).toBe("Turn timed out before the model finished responding");
});

for (const reason of ["Continue goal", "Goal updated", "Goal budget reached", "Finalize goal"]) {
  test(`Goal display hides only validated lifecycle metadata: ${reason}`, () => {
    const visible = `🎯 ${reason}: Keep the objective <unchanged> & intact`;
    const input = visible + '\n\n<piclaw_goal_input>{"goalId":"goal-1","generation":7}</piclaw_goal_input>';
    expect(getDisplayContent(input, [])).toBe(visible);
    expect(input).toContain('"generation":7');
    for (const metadata of ['bad-json', '{"goalId":"goal-1","generation":0}', '{"goalId":"goal-1","generation":1,"extra":true}'])
      expect(getDisplayContent(visible + '\n\n<piclaw_goal_input>' + metadata + '</piclaw_goal_input>', []))
        .toBe(visible + '\n\n<piclaw_goal_input>' + metadata + '</piclaw_goal_input>');
    const ordinary = input.replace(visible, "Ordinary input");
    expect(getDisplayContent(ordinary, [])).toBe(ordinary);
  });
}

for (const [prefix, reason, tag] of [
  ["Continue working toward the active thread goal.", "Continue goal", "objective"],
  ["The active thread goal objective was edited by the user.", "Goal updated", "untrusted_objective"],
  ["The active thread goal has reached its token budget.", "Goal budget reached", "objective"],
  ["The current Plan Sidebar checklist has no pending or in-progress items.", "Finalize goal", "objective"],
]) {
  test(`Historical expanded Goal input projects without rewriting history: ${reason}`, () => {
    const input = `${prefix}\n\n<${tag}>\nKeep &lt;scope&gt; &amp; literal &amp;lt; intact\n</${tag}>\n\nFull model instructions.\n\n<piclaw_goal_input>{"goalId":"goal-1","generation":7}</piclaw_goal_input>`;
    expect(getDisplayContent(input, [])).toBe(`🎯 ${reason}: Keep <scope> & literal &lt; intact`);
    expect(input).toContain("Full model instructions.");
    expect(getDisplayContent(input.replace('"generation":7', '"generation":0'), [])).toContain("Full model instructions.");
    expect(getDisplayContent(input.replace(`<${tag}>`, "missing-objective"), [])).toBe(input.replace(`<${tag}>`, "missing-objective"));
  });
}
