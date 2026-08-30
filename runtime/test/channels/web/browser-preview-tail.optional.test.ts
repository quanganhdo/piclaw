import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright";
import { startDedicatedWebTestInstance, type DedicatedWebTestInstance } from "./helpers/dedicated-instance.js";

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;

let instance: DedicatedWebTestInstance | null = null;
let browser: Browser | null = null;
let context: BrowserContext | null = null;

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  const browserType = process.env.PICLAW_OPTIONAL_BROWSER === "webkit" ? webkit : chromium;
  browser = await browserType.launch({ headless: true });
});

afterEach(async () => {
  await context?.close();
  context = null;
  await instance?.close();
  instance = null;
});

afterAll(async () => {
  await browser?.close();
  browser = null;
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function seedRootChat(db: any) {
  const now = new Date().toISOString();
  db.storeChatMetadata("web:default", now, "Preview Tail Test");
  db.ensureChatBranch({
    chat_jid: "web:default",
    root_chat_jid: "web:default",
    parent_branch_id: null,
    agent_name: "root",
  });
}

function createPreviewAgentPool(db: any, gates: {
  firstDraftReady: ReturnType<typeof deferred>;
  continueDraft: ReturnType<typeof deferred>;
  finalDraftReady: ReturnType<typeof deferred>;
  completeTurn: ReturnType<typeof deferred>;
}) {
  const activeChats = new Set<string>();
  const toActiveChat = (branch: any) => ({
    branch_id: branch.branch_id,
    chat_jid: branch.chat_jid,
    root_chat_jid: branch.root_chat_jid,
    parent_branch_id: branch.parent_branch_id,
    agent_name: branch.agent_name,
    display_name: null,
    session_id: null,
    session_name: branch.agent_name,
    model: null,
    is_active: activeChats.has(branch.chat_jid),
    has_side_session: false,
  });
  const thoughtLines = Array.from({ length: 24 }, (_, index) => `thought-line-${String(index + 1).padStart(2, "0")}`);
  const draftLines = Array.from({ length: 24 }, (_, index) => `draft-line-${String(index + 1).padStart(2, "0")}`);

  const emitDeltas = (options: { onEvent?: (event: any) => void }, type: "thinking_delta" | "text_delta", lines: string[], start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      options.onEvent?.({
        type: "message_update",
        assistantMessageEvent: {
          type,
          delta: `${index === 0 ? "" : "\n"}${lines[index]}`,
        },
      });
    }
  };

  return {
    isStreaming: (chatJid: string) => activeChats.has(chatJid),
    isActive: (chatJid: string) => activeChats.has(chatJid),
    getContextUsageForChat: async () => null,
    getAvailableModels: async () => ({
      current: null,
      models: [],
      thinking_level: null,
      supports_thinking: true,
      provider_usage: null,
    }),
    getCurrentModelLabel: async () => null,
    listKnownChats: (rootChatJid?: string | null) => db.listChatBranches(rootChatJid || null).map(toActiveChat),
    listActiveChats: () => db.listChatBranches(null).map(toActiveChat),
    getAgentHandleForChat: (chatJid: string) => db.getChatBranchByChatJid(chatJid)?.agent_name || "agent",
    findChatByAgentName: (agentName: string) => {
      const branch = db.getChatBranchByAgentName(String(agentName || "").trim().toLowerCase());
      return branch ? { chat_jid: branch.chat_jid, agent_name: branch.agent_name } : null;
    },
    runAgent: async (_prompt: string, chatJid: string, options: {
      onEvent?: (event: any) => void;
      onTurnComplete?: (turn: { text: string; attachments: unknown[] }) => void;
    } = {}) => {
      activeChats.add(chatJid);
      try {
        options.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } });
        emitDeltas(options, "thinking_delta", thoughtLines, 0, thoughtLines.length);
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "thinking_end", content: thoughtLines.join("\n") },
        });

        options.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "text_start" } });
        emitDeltas(options, "text_delta", draftLines, 0, 12);
        gates.firstDraftReady.resolve();
        await gates.continueDraft.promise;

        // The final twelve deltas are intentionally emitted inside one client
        // throttle window. The last delta must still reach state and the DOM.
        emitDeltas(options, "text_delta", draftLines, 12, draftLines.length);
        gates.finalDraftReady.resolve();
        await gates.completeTurn.promise;

        const reply = "PREVIEW_TAIL_BROWSER_DONE";
        options.onTurnComplete?.({ text: reply, attachments: [] });
        return { status: "success", result: reply };
      } finally {
        activeChats.delete(chatJid);
      }
    },
  };
}

async function launchDedicatedInstance(gates: Parameters<typeof createPreviewAgentPool>[1]): Promise<DedicatedWebTestInstance> {
  let seededDb: any;
  const agentPoolStub: any = { getContextUsageForChat: async () => null };
  instance = await startDedicatedWebTestInstance({
    prefix: "piclaw-browser-preview-tail-",
    seed: (db) => {
      seededDb = db;
      seedRootChat(db);
    },
    agentPool: agentPoolStub,
  });
  Object.assign(agentPoolStub, createPreviewAgentPool(seededDb, gates));
  instance.web.agentPool = agentPoolStub;
  return instance;
}

async function installEventSourceAudit(contextToInstrument: BrowserContext) {
  await contextToInstrument.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    const audit = {
      created: 0,
      active: 0,
      maxActive: 0,
      events: {} as Record<string, number>,
      domMarks: [] as Array<{ marker: string; draftDeltas: number; thoughtDeltas: number }>,
    };
    const tracked = new WeakSet<EventSource>();
    const markClosed = (source: EventSource) => {
      if (tracked.has(source)) {
        tracked.delete(source);
        audit.active = Math.max(0, audit.active - 1);
      }
    };

    class AuditedEventSource extends NativeEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict);
        audit.created += 1;
        audit.active += 1;
        audit.maxActive = Math.max(audit.maxActive, audit.active);
        tracked.add(this);
        for (const eventName of [
          "agent_status", "agent_thought", "agent_thought_delta",
          "agent_draft", "agent_draft_delta", "agent_response",
        ]) {
          this.addEventListener(eventName, () => {
            audit.events[eventName] = (audit.events[eventName] || 0) + 1;
          });
        }
        this.addEventListener("error", () => {
          if (this.readyState === NativeEventSource.CLOSED) markClosed(this);
        });
      }

      close() {
        markClosed(this);
        super.close();
      }
    }

    Object.defineProperties(AuditedEventSource, {
      CONNECTING: { value: NativeEventSource.CONNECTING },
      OPEN: { value: NativeEventSource.OPEN },
      CLOSED: { value: NativeEventSource.CLOSED },
    });
    (window as any).EventSource = AuditedEventSource;
    (window as any).__piclawPreviewAudit = audit;

    const recordDomMarks = () => {
      const bodyText = document.body?.innerText || "";
      for (const marker of ["thought-line-24", "draft-line-24"]) {
        if (bodyText.includes(marker) && !audit.domMarks.some((entry) => entry.marker === marker)) {
          audit.domMarks.push({
            marker,
            draftDeltas: audit.events.agent_draft_delta || 0,
            thoughtDeltas: audit.events.agent_thought_delta || 0,
          });
        }
      }
    };
    window.addEventListener("DOMContentLoaded", () => {
      new MutationObserver(recordDomMarks).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      recordDomMarks();
    });
  });
}

async function openChatWindow(page: Page, baseUrl: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("chat_jid", "web:default");
  url.searchParams.set("chat_only", "1");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea", { timeout: 15000 });
}

async function panelText(page: Page, panelKey: "thought" | "draft") {
  return (await page.locator(`.agent-thinking[data-panel-key="${panelKey}"] .agent-thinking-body`).textContent()) || "";
}

async function waitForPanelMarker(page: Page, panelKey: "thought" | "draft", marker: string) {
  await page.waitForFunction(({ panelKey, marker }) => {
    return Boolean(document.querySelector(`.agent-thinking[data-panel-key="${panelKey}"] .agent-thinking-body`)?.textContent?.includes(marker));
  }, { panelKey, marker });
}

optionalBrowserTest("bundled browser keeps authoritative Draft/Thought tails through collapse, expand, throttle, and terminal delivery", async () => {
  const gates = {
    firstDraftReady: deferred(),
    continueDraft: deferred(),
    finalDraftReady: deferred(),
    completeTurn: deferred(),
  };
  const dedicated = await launchDedicatedInstance(gates);
  context = await browser!.newContext();
  await installEventSourceAudit(context);
  const page = await context.newPage();
  await openChatWindow(page, dedicated.baseUrl);

  const fullPreviewRequestPattern = "**/agent/thought?**";
  await page.route(fullPreviewRequestPattern, async (route) => {
    const requestUrl = new URL(route.request().url());
    if (route.request().method() === "GET" && requestUrl.pathname === "/agent/thought") {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.locator("textarea").fill("PREVIEW_TAIL_BROWSER_START");
  await page.locator("button.send-btn").click();
  await gates.firstDraftReady.promise;
  await waitForPanelMarker(page, "draft", "draft-line-12");
  await waitForPanelMarker(page, "thought", "thought-line-24");

  const thoughtCollapsed = await panelText(page, "thought");
  expect(thoughtCollapsed).toContain("thought-line-24");
  expect(thoughtCollapsed).toContain("thought-line-16");
  expect(thoughtCollapsed).not.toContain("thought-line-01");

  // Keep the full-buffer GET blocked while expanding so this inspection can
  // only use client state accumulated through the production SSE ordering.
  const thoughtPanel = page.locator('.agent-thinking[data-panel-key="thought"]');
  await thoughtPanel.locator("button.agent-thinking-truncation").click();
  await page.waitForFunction(() => document.querySelector('.agent-thinking[data-panel-key="thought"]')?.getAttribute("data-expanded") === "true");
  const thoughtExpanded = await panelText(page, "thought");
  expect(thoughtExpanded.match(/thought-line-\d{2}/g)).toEqual(
    Array.from({ length: 24 }, (_, index) => `thought-line-${String(index + 1).padStart(2, "0")}`),
  );
  expect((thoughtExpanded.match(/thought-line-01/g) || []).length).toBe(1);
  expect((thoughtExpanded.match(/thought-line-24/g) || []).length).toBe(1);
  await thoughtPanel.locator("button.agent-thinking-truncation").click();
  await page.waitForFunction(() => document.querySelector('.agent-thinking[data-panel-key="thought"]')?.getAttribute("data-expanded") === "false");

  const draftCollapsedAt12 = await panelText(page, "draft");
  expect(draftCollapsedAt12).toContain("draft-line-12");
  expect(draftCollapsedAt12).toContain("draft-line-04");
  expect(draftCollapsedAt12).not.toContain("draft-line-01");

  const draftPanel = page.locator('.agent-thinking[data-panel-key="draft"]');
  await draftPanel.locator("button.agent-thinking-truncation").click();
  await page.waitForFunction(() => document.querySelector('.agent-thinking[data-panel-key="draft"]')?.getAttribute("data-expanded") === "true");
  const draftExpandedAt12 = await panelText(page, "draft");
  expect(draftExpandedAt12.match(/draft-line-\d{2}/g)).toEqual(
    Array.from({ length: 12 }, (_, index) => `draft-line-${String(index + 1).padStart(2, "0")}`),
  );
  expect((draftExpandedAt12.match(/draft-line-01/g) || []).length).toBe(1);
  expect((draftExpandedAt12.match(/draft-line-12/g) || []).length).toBe(1);

  await draftPanel.locator("button.agent-thinking-truncation").click();
  await page.waitForFunction(() => document.querySelector('.agent-thinking[data-panel-key="draft"]')?.getAttribute("data-expanded") === "false");
  gates.continueDraft.resolve();
  await gates.finalDraftReady.promise;

  // The final suffix must become visible during the live pause while the
  // authoritative full-buffer endpoint is still blocked and before terminal.
  await waitForPanelMarker(page, "draft", "draft-line-24");
  const livePausedCollapsedTail = await panelText(page, "draft");
  expect(livePausedCollapsedTail).toContain("draft-line-24");
  expect(livePausedCollapsedTail).toContain("draft-line-16");

  // Restore the real full-buffer endpoint for the final throttled-delta check.
  // The unmasked local Draft/Thought state was already asserted above.
  await page.unroute(fullPreviewRequestPattern);
  await draftPanel.locator("button.agent-thinking-truncation").click();
  await page.waitForFunction(() => document.querySelector('.agent-thinking[data-panel-key="draft"]')?.getAttribute("data-expanded") === "true");
  await waitForPanelMarker(page, "draft", "draft-line-24");
  const draftExpandedAt24 = await panelText(page, "draft");
  expect(draftExpandedAt24).toContain("draft-line-01");
  expect(draftExpandedAt24).toContain("draft-line-24");
  expect((draftExpandedAt24.match(/draft-line-24/g) || []).length).toBe(1);

  await draftPanel.locator("button.agent-thinking-truncation").click();
  await page.waitForFunction(() => document.querySelector('.agent-thinking[data-panel-key="draft"]')?.getAttribute("data-expanded") === "false");
  const draftCollapsedAt24 = await panelText(page, "draft");
  expect(draftCollapsedAt24).toContain("draft-line-24");
  expect(draftCollapsedAt24).toContain("draft-line-16");
  expect(draftCollapsedAt24).not.toContain("draft-line-01");

  gates.completeTurn.resolve();
  await page.waitForFunction(() => document.body?.innerText?.includes("PREVIEW_TAIL_BROWSER_DONE"));

  const audit = await page.evaluate(() => (window as any).__piclawPreviewAudit);
  expect(audit.created).toBe(1);
  expect(audit.maxActive).toBe(1);
  expect(audit.active).toBe(1);
  expect(audit.events.agent_draft_delta).toBeGreaterThanOrEqual(2);
  expect(audit.events.agent_draft_delta).toBeLessThan(12);
  expect(audit.events.agent_thought_delta).toBeGreaterThanOrEqual(2);
  expect(audit.events.agent_thought_delta).toBeLessThan(12);
  expect(audit.domMarks).toContainEqual({
    marker: "draft-line-24",
    draftDeltas: audit.events.agent_draft_delta,
    thoughtDeltas: audit.events.agent_thought_delta,
  });
  expect(audit.domMarks.some((entry: any) => entry.marker === "thought-line-24" && entry.thoughtDeltas >= 2 && entry.thoughtDeltas < 12)).toBe(true);
}, 30000);
