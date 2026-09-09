/**
 * test/web/adaptive-card-renderer.test.ts – Tests for Adaptive Card block extraction and validation.
 */
import { expect, test, describe } from "bun:test";
import {
  isAdaptiveCardBlock,
  isSupportedVersion,
  extractCardBlocks,
  normalizeAdaptiveCardAction,
  describeAdaptiveCardState,
  hydrateAdaptiveCardPayloadWithSubmission,
  sanitizeAdaptiveCardPayloadForReadOnly,
  sanitizeAdaptiveCardRenderedResources,
  processAdaptiveCardMarkdown,
  createAdaptiveCardMarkdownProcessor,
} from "../../web/src/ui/adaptive-card-renderer.js";
import { pickHighestContrastColor } from "../../web/src/ui/adaptive-card-host-config.js";

describe("isAdaptiveCardBlock", () => {
  test("accepts valid card block", () => {
    expect(isAdaptiveCardBlock({
      type: "adaptive_card",
      card_id: "abc-123",
      schema_version: "1.5",
      state: "active",
      payload: { type: "AdaptiveCard", version: "1.5", body: [] },
    })).toBe(true);
  });

  test("rejects missing type", () => {
    expect(isAdaptiveCardBlock({
      card_id: "abc",
      schema_version: "1.5",
      state: "active",
      payload: {},
    })).toBe(false);
  });

  test("rejects wrong type", () => {
    expect(isAdaptiveCardBlock({ type: "image", card_id: "x" })).toBe(false);
  });

  test("rejects null payload", () => {
    expect(isAdaptiveCardBlock({
      type: "adaptive_card",
      card_id: "x",
      schema_version: "1.5",
      state: "active",
      payload: null,
    })).toBe(false);
  });

  test("rejects malformed state, identity, and payload shapes", () => {
    expect(isAdaptiveCardBlock("string")).toBe(false);
    expect(isAdaptiveCardBlock(null)).toBe(false);
    expect(isAdaptiveCardBlock(undefined)).toBe(false);
    expect(isAdaptiveCardBlock({ type: "adaptive_card", card_id: "", schema_version: "1.5", state: "active", payload: {} })).toBe(false);
    expect(isAdaptiveCardBlock({ type: "adaptive_card", card_id: "card", schema_version: "1.5", state: "unknown", payload: {} })).toBe(false);
    expect(isAdaptiveCardBlock({ type: "adaptive_card", card_id: "card", schema_version: "1.5", state: "active", payload: [] })).toBe(false);
  });
});

describe("isSupportedVersion", () => {
  test("accepts supported versions", () => {
    expect(isSupportedVersion("1.0")).toBe(true);
    expect(isSupportedVersion("1.3")).toBe(true);
    expect(isSupportedVersion("1.5")).toBe(true);
    expect(isSupportedVersion("1.6")).toBe(true);
  });

  test("rejects unsupported versions", () => {
    expect(isSupportedVersion("2.0")).toBe(false);
    expect(isSupportedVersion("0.9")).toBe(false);
    expect(isSupportedVersion("")).toBe(false);
  });
});

describe("extractCardBlocks", () => {
  test("extracts card blocks from mixed content_blocks and normalizes legacy missing state", () => {
    const blocks = [
      { type: "text", text: "hello" },
      {
        type: "adaptive_card",
        card_id: "card-1",
        schema_version: "1.5",
        state: "active",
        payload: { type: "AdaptiveCard", version: "1.5", body: [] },
      },
      { type: "adaptive_card", card_id: "legacy", schema_version: "1.5", payload: { type: "AdaptiveCard", version: "1.5", body: [] } },
      { type: "image" },
      {
        type: "adaptive_card",
        card_id: "card-2",
        schema_version: "1.5",
        state: "completed",
        payload: { type: "AdaptiveCard", version: "1.5", body: [] },
      },
    ];
    const cards = extractCardBlocks(blocks);
    expect(cards).toHaveLength(3);
    expect(cards[0].card_id).toBe("card-1");
    expect(cards[1]).toMatchObject({ card_id: "legacy", state: "active" });
    expect(cards[2].card_id).toBe("card-2");
  });

  test("returns empty for no card blocks", () => {
    expect(extractCardBlocks([{ type: "text" }])).toHaveLength(0);
  });

  test("returns empty for non-array", () => {
    expect(extractCardBlocks(null)).toHaveLength(0);
    expect(extractCardBlocks(undefined)).toHaveLength(0);
    expect(extractCardBlocks("string")).toHaveLength(0);
  });
});

describe("normalizeAdaptiveCardAction", () => {
  test("normalizes submit actions from JSON-like objects", () => {
    const action = normalizeAdaptiveCardAction({
      getJsonTypeName: () => "Action.Submit",
      title: "Approve",
      data: { ok: true },
      toJSON: () => ({ type: "Action.Submit", title: "Approve", data: { ok: true } }),
    });
    expect(action.type).toBe("Action.Submit");
    expect(action.title).toBe("Approve");
    expect(action.data).toEqual({ ok: true });
  });

  test("normalizes open url actions", () => {
    const action = normalizeAdaptiveCardAction({
      getJsonTypeName: () => "Action.OpenUrl",
      title: "Docs",
      url: "https://adaptivecards.io/",
    });
    expect(action.type).toBe("Action.OpenUrl");
    expect(action.url).toBe("https://adaptivecards.io/");
  });
});

describe("processAdaptiveCardMarkdown", () => {
  test("uses the provided markdown renderer and marks the result as processed", () => {
    const rendered = processAdaptiveCardMarkdown("**Bold**", (input) => `<p><strong>${input.slice(2, -2)}</strong></p>`);
    expect(rendered.didProcess).toBe(true);
    expect(rendered.outputHtml).toBe("<p><strong>Bold</strong></p>");
  });

  test("adaptive card markdown processor writes HTML into the SDK callback result", () => {
    const result: { outputHtml?: string; didProcess?: boolean } = {};
    const processor = createAdaptiveCardMarkdownProcessor((input) => `<p>${input.toUpperCase()}</p>`);
    processor("hello", result);
    expect(result).toEqual({ outputHtml: "<p>HELLO</p>", didProcess: true });
  });
});

describe("pickHighestContrastColor", () => {
  test("chooses the strongest candidate against the accent background", () => {
    expect(pickHighestContrastColor("#111111", ["#ffffff", "#222222"], "#ffffff")).toBe("#ffffff");
    expect(pickHighestContrastColor("#f4f4f4", ["#ffffff", "#111111"], "#ffffff")).toBe("#111111");
  });
});

describe("read-only Adaptive Card payloads", () => {
  test("remove indirect URLs and actions without dropping surrounding content", () => {
    expect(sanitizeAdaptiveCardPayloadForReadOnly({
      type: "AdaptiveCard",
      backgroundImage: "https://foreign.example/background.png",
      body: [{
        type: "Container",
        selectAction: { type: "Action.OpenUrl", url: "https://foreign.example/open" },
        items: [
          { type: "Image", url: "https://foreign.example/image.png", altText: "Remote chart" },
          { type: "Image", url: "/media/7", altText: "Owned chart" },
          { type: "TextBlock", text: "Remote ![pixel](https://foreign.example/pixel.png) owned ![plot](/media/8)" },
          { type: "Input.Text", id: "query", inlineAction: { type: "Action.Submit", title: "Go" } },
        ],
      }],
      actions: [{ type: "Action.Submit", title: "Submit" }],
    }, (value) => /^\/media\/[1-9]\d*$/.test(value) ? value : "")).toEqual({
      type: "AdaptiveCard",
      body: [{ type: "Container", items: [
        { type: "Image", altText: "Remote chart" },
        { type: "Image", url: "/media/7", altText: "Owned chart" },
        { type: "TextBlock", text: "Remote pixel owned plot" },
        { type: "TextBlock", text: "Input unavailable", wrap: true, isSubtle: true },
      ] }],
    });
  });

  test("remove SDK-rendered indirect resources while preserving owned media", () => {
    if (typeof document === "undefined") return;
    const root = document.createElement("div");
    root.innerHTML = '<img src="https://foreign.example/a.png" srcset="https://foreign.example/a2.png 2x"><img src="/media/7"><svg><image href="https://foreign.example/b.png"></image></svg><div style="background:url(https://foreign.example/c.png)"></div>';
    sanitizeAdaptiveCardRenderedResources(root, (value) => /^\/media\/[1-9]\d*$/.test(value) ? value : "");
    expect(root.innerHTML).not.toContain("foreign.example");
    expect(root.querySelector('img[src="/media/7"]')).not.toBeNull();
  });
});

describe("describeAdaptiveCardState", () => {
  test("returns null for active cards", () => {
    expect(describeAdaptiveCardState({
      type: "adaptive_card",
      card_id: "card-1",
      schema_version: "1.5",
      state: "active",
      payload: {},
    })).toBeNull();
  });

  test("describes completed cards concisely without echoing submitted values in the banner", () => {
    const meta = describeAdaptiveCardState({
      type: "adaptive_card",
      card_id: "card-1",
      schema_version: "1.5",
      state: "completed",
      payload: {},
      last_submission: {
        title: "Submit choices",
        data: { priority: "high", targets: ["docs", "tests"] },
      },
    });
    expect(meta?.label).toBe("Submitted");
    expect(meta?.detail).toContain("Submit choices");
    expect(meta?.detail).not.toContain("priority: high");
  });

  test("hydrates finished card payloads with submitted values", () => {
    const hydrated = hydrateAdaptiveCardPayloadWithSubmission({
      type: "AdaptiveCard",
      body: [
        { type: "Input.Text", id: "title", label: "Title" },
        { type: "Input.ChoiceSet", id: "targets", isMultiSelect: true },
        { type: "Input.Toggle", id: "confirm", valueOn: "yes", valueOff: "no" },
      ],
    }, {
      title: "Queued fix",
      targets: ["docs", "tests"],
      confirm: true,
    });

    expect((hydrated.body as any[])[0]?.value).toBe("Queued fix");
    expect((hydrated.body as any[])[1]?.value).toBe("docs,tests");
    expect((hydrated.body as any[])[2]?.value).toBe("yes");
  });
});
