import { describe, expect, test } from "bun:test";
import {
  buildAdaptiveCardSubmissionFallbackText,
  describeAdaptiveCardSubmission,
  extractAdaptiveCardSubmissionBlocks,
  isAdaptiveCardSubmissionBlock,
} from "../../web/src/ui/adaptive-card-submission.ts";

describe("adaptive card submission helpers", () => {
  test("accepts valid adaptive card submission blocks", () => {
    expect(isAdaptiveCardSubmissionBlock({
      type: "adaptive_card_submission",
      card_id: "card-1",
      source_post_id: 42,
      submitted_at: "2026-03-15T12:00:00.000Z",
      action_type: "Action.Submit",
    })).toBe(true);
  });

  test("rejects malformed identity, time, and action fields", () => {
    for (const block of [
      { type: "adaptive_card_submission", card_id: "", source_post_id: 42, submitted_at: "2026-03-15T12:00:00.000Z", action_type: "Action.Submit" },
      { type: "adaptive_card_submission", card_id: "card", source_post_id: 1.5, submitted_at: "2026-03-15T12:00:00.000Z", action_type: "Action.Submit" },
      { type: "adaptive_card_submission", card_id: "card", source_post_id: 42, submitted_at: "invalid", action_type: "Action.Submit" },
      { type: "adaptive_card_submission", card_id: "card", source_post_id: 42, submitted_at: "2026-03-15T12:00:00.000Z", action_type: "Action.OpenUrl" },
    ]) expect(isAdaptiveCardSubmissionBlock(block)).toBe(false);
  });

  test("extracts submission blocks and normalizes legacy missing action type", () => {
    const blocks = extractAdaptiveCardSubmissionBlocks([
      { type: "text", text: "hello" },
      {
        type: "adaptive_card_submission",
        card_id: "card-1",
        source_post_id: 42,
        submitted_at: "2026-03-15T12:00:00.000Z",
        action_type: "Action.Submit",
      },
      {
        type: "adaptive_card_submission",
        card_id: "legacy",
        source_post_id: 41,
        submitted_at: "2026-03-15T11:59:00.000Z",
      },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.card_id).toBe("card-1");
    expect(blocks[1]).toMatchObject({ card_id: "legacy", action_type: "Action.Submit" });
  });

  test("rebuilds the persisted fallback submission text", () => {
    expect(buildAdaptiveCardSubmissionFallbackText({
      type: "adaptive_card_submission",
      card_id: "card-1",
      source_post_id: 42,
      submitted_at: "2026-03-15T12:00:00.000Z",
      action_type: "Action.Submit",
      title: "Approve",
      data: { env: "prod", dryRun: false },
    })).toBe("Card submission: Approve — env: prod, dryRun: no");
  });

  test("shows all fields in submission receipt without truncation", () => {
    const meta = describeAdaptiveCardSubmission({
      type: "adaptive_card_submission",
      card_id: "card-2",
      source_post_id: 43,
      submitted_at: "2026-03-15T12:01:00.000Z",
      action_type: "Action.Submit",
      title: "Complex",
      data: {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
      },
    });
    expect(meta.fieldCount).toBe(5);
    expect(meta.fields).toHaveLength(5);
    expect(meta.fields[4]).toEqual({ key: "five", value: "5" });
  });

  test("submission fallback text includes every explicit field", () => {
    const rendered = buildAdaptiveCardSubmissionFallbackText({
      type: "adaptive_card_submission",
      card_id: "card-7",
      source_post_id: 47,
      submitted_at: "2026-03-15T12:05:00.000Z",
      action_type: "Action.Submit",
      title: "Full payload",
      data: {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
      },
    });
    expect(rendered).toContain("one: 1");
    expect(rendered).toContain("six: 6");
  });

  test("describes submission receipts compactly", () => {
    const meta = describeAdaptiveCardSubmission({
      type: "adaptive_card_submission",
      card_id: "card-1",
      source_post_id: 42,
      submitted_at: "2026-03-15T12:00:00.000Z",
      action_type: "Action.Submit",
      title: "Submit choices",
      data: { priority: "high", targets: ["docs", "tests"] },
    });
    expect(meta.title).toBe("Submit choices");
    expect(meta.summary).toContain("priority: high");
    expect(meta.summary).toContain("targets: docs, tests");
    expect(meta.fields).toEqual([
      { key: "priority", value: "high" },
      { key: "targets", value: "docs, tests" },
    ]);
    expect(meta.fieldCount).toBe(2);
  });

  test("sanitizes __internal fields from submission data", () => {
    const meta = describeAdaptiveCardSubmission({
      type: "adaptive_card_submission",
      card_id: "card-3",
      source_post_id: 44,
      submitted_at: "2026-03-15T12:02:00.000Z",
      action_type: "Action.Submit",
      title: "Sanitized",
      data: {
        one: "1",
        two: "2",
        three: "3",
        four: "4",
        five: { visible: "ok", __secret: "hide-me" },
      },
    });
    expect(meta.fieldCount).toBe(5);
    expect(meta.fields).toHaveLength(5);
    expect(meta.fields[4]).toEqual({ key: "five", value: "visible: ok" });
  });

  test("handles large triage-style submissions with all fields visible", () => {
    const data: Record<string, string> = {
      intent: "kanban-triage-inbox",
      scope: "00-inbox",
    };
    for (let i = 1; i <= 19; i++) {
      data[`ticket_${i}`] = i % 3 === 0 ? "next" : "inbox";
    }
    const meta = describeAdaptiveCardSubmission({
      type: "adaptive_card_submission",
      card_id: "triage-card",
      source_post_id: 100,
      submitted_at: "2026-03-18T21:25:00.000Z",
      action_type: "Action.Submit",
      title: "Apply lane updates",
      data,
    });
    expect(meta.fieldCount).toBe(21);
    expect(meta.fields).toHaveLength(21);
    // Verify specific fields are present
    expect(meta.fields.find((f) => f.key === "ticket_19")).toEqual({ key: "ticket_19", value: "inbox" });
    expect(meta.fields.find((f) => f.key === "ticket_3")).toEqual({ key: "ticket_3", value: "next" });
  });
});
