import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerToolStatusHintProvider } from "../../../src/tool-status-hints.js";

const CDP_BROWSER_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 20h8"></path><path d="M12 18v2"></path></svg>`;
let cachedModule: Promise<typeof import("../cdp-browser/index.ts")> | null = null;

function readTrimmedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function extractHostLabelFromUrl(value: unknown): string | null {
  const raw = readTrimmedString(value);
  if (!raw) return null;
  try {
    return new URL(raw).host || null;
  } catch {
    return null;
  }
}

async function loadModule(): Promise<typeof import("../cdp-browser/index.ts")> {
  if (!cachedModule) cachedModule = import("../cdp-browser/index.ts");
  return await cachedModule;
}

registerToolStatusHintProvider({
  id: "cdp_browser",
  buildHints: ({ toolName, args }) => {
    if (toolName !== "cdp_browser") return null;
    const record = args && typeof args === "object" ? args as Record<string, unknown> : null;
    const label = extractHostLabelFromUrl(record?.url)
      || readTrimmedString(record?.match)
      || readTrimmedString(record?.action);
    if (!label) return null;
    return {
      key: "cdp_browser",
      icon_svg: CDP_BROWSER_STATUS_ICON_SVG,
      label,
      title: `Browser target • ${label}`,
      kind: "service",
    };
  },
});

export default function register(pi: ExtensionAPI) {
  pi.registerTool({
    name: "cdp_browser",
    label: "CDP Browser Control",
    description:
      "Control any Chromium browser (Edge/Chrome) via Chrome DevTools Protocol. " +
      "Actions: tabs (list tabs), eval (run JS), navigate (go to URL), open (new tab), " +
      "close (close tabs), click (click element), screenshot (capture page), print_pdf (export page to PDF), sleep (wait ms).",
    promptSnippet: "Control Edge browser tabs, evaluate JS, navigate, screenshot or export PDF via CDP",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "One of: tabs, eval, navigate, open, close, click, screenshot, print_pdf, sleep" },
        expr: { type: "string", description: "JS expression (for eval action)" },
        url: { type: "string", description: "URL (for navigate/open/print_pdf actions)" },
        selector: { type: "string", description: "CSS selector (for click action)" },
        match: { type: "string", description: "Tab title/URL substring to target a specific tab" },
        outPath: { type: "string", description: "Output file path (for screenshot/print_pdf)" },
        ms: { type: "number", description: "Milliseconds to sleep (sleep) or wait before printing (print_pdf)" },
        landscape: { type: "boolean", description: "Landscape orientation for print_pdf" },
        displayHeaderFooter: { type: "boolean", description: "Whether print_pdf should render header/footer HTML" },
        headerTemplate: { type: "string", description: "HTML header template for print_pdf" },
        footerTemplate: { type: "string", description: "HTML footer template for print_pdf" },
        preferCSSPageSize: { type: "boolean", description: "Prefer CSS @page size for print_pdf (default true)" },
      },
      required: ["action"],
    },
    async execute(_id, params, signal, _onUpdate, ctx) {
      const mod = await loadModule();
      const release = (globalThis as any).__piclaw_beginCdpViewTool?.("cdp");
      try { return await mod.executeCdpBrowserTool(params, signal, ctx as { cwd?: string } | undefined); }
      finally { release?.(); }
    },
  });

  pi.registerCommand("cdp-tabs", {
    description: "List browser tabs via CDP",
    handler: async (args, ctx) => {
      const mod = await loadModule();
      await mod.executeCdpTabsCommand(args, ctx);
    },
  });
}
