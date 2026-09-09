/**
 * ui/adaptive-card-renderer.ts – Render Adaptive Card JSON payloads in the web timeline.
 *
 * Lazy-loads the vendored adaptivecards SDK on first use, builds a HostConfig
 * from the current theme, and renders cards into container elements.
 *
 * Consumers:
 *   - web/src/components/post.ts calls renderAdaptiveCard() when a post
 *     contains an adaptive_card content block.
 */

import { renderMarkdown } from "../markdown.js";
import { lockAdaptiveCardInputs } from "./adaptive-card-input-lock.js";
import { buildHostConfig, getAdaptiveCardThemeValues } from "./adaptive-card-host-config.js";

/** Shape of an adaptive_card content block in a message's content_blocks. */
export interface AdaptiveCardBlock {
  type: "adaptive_card";
  card_id: string;
  schema_version: string;
  state: "active" | "completed" | "cancelled" | "failed";
  payload: Record<string, unknown>;
  fallback_text?: string;
  completed_at?: string;
  last_submission?: unknown;
}

export interface AdaptiveCardActionInfo {
  type: string;
  title: string;
  data?: unknown;
  url?: string;
  raw: unknown;
}

/** Supported Adaptive Card schema versions. */
const SUPPORTED_VERSIONS = new Set(["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6"]);

let sdkLoaded = false;
let sdkLoadPromise: Promise<void> | null = null;
let markdownProcessorConfigured = false;

function clearAdaptiveCardNotice(container: HTMLElement): void {
  container.querySelector(".adaptive-card-notice")?.remove();
}

function showAdaptiveCardNotice(container: HTMLElement, message: string, tone: "error" | "info" = "error"): void {
  clearAdaptiveCardNotice(container);
  const notice = document.createElement("div");
  notice.className = `adaptive-card-notice adaptive-card-notice-${tone}`;
  notice.textContent = message;
  container.appendChild(notice);
}

export function processAdaptiveCardMarkdown(
  text: string,
  renderer: (source: string) => string = (source) => renderMarkdown(source, null),
): { outputHtml: string; didProcess: boolean } {
  const source = typeof text === "string" ? text : String(text ?? "");
  if (!source.trim()) {
    return { outputHtml: "", didProcess: false };
  }
  return {
    outputHtml: renderer(source),
    didProcess: true,
  };
}

export function createAdaptiveCardMarkdownProcessor(
  renderer: (source: string) => string = (source) => renderMarkdown(source, null),
) {
  return (text: string, result: { outputHtml?: string; didProcess?: boolean }) => {
    try {
      const processed = processAdaptiveCardMarkdown(text, renderer);
      result.outputHtml = processed.outputHtml;
      result.didProcess = processed.didProcess;
    } catch (error) {
      console.error("[adaptive-card] Failed to process markdown:", error);
      result.outputHtml = String(text ?? "");
      result.didProcess = false;
    }
  };
}

function ensureAdaptiveCardMarkdownProcessor(AC: any): void {
  if (markdownProcessorConfigured || !AC?.AdaptiveCard) return;
  AC.AdaptiveCard.onProcessMarkdown = createAdaptiveCardMarkdownProcessor();
  markdownProcessorConfigured = true;
}

/** Lazy-load the vendored adaptivecards SDK. */
async function ensureSdk(): Promise<void> {
  if (sdkLoaded) return;
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/static/common/js/vendor/adaptivecards.min.js";
    script.onload = () => {
      sdkLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load adaptivecards SDK"));
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

/** Get the global AdaptiveCards namespace after SDK is loaded. */
function getAC(): typeof import("adaptivecards") {
  return (globalThis as any).AdaptiveCards;
}

/**
 * Check whether a content block is a renderable adaptive card.
 */
export function isAdaptiveCardBlock(block: unknown): block is AdaptiveCardBlock {
  if (!block || typeof block !== "object") return false;
  const b = block as Record<string, unknown>;
  return (
    b.type === "adaptive_card" &&
    typeof b.card_id === "string" &&
    b.card_id.trim().length > 0 &&
    b.card_id.length <= 256 &&
    typeof b.schema_version === "string" &&
    b.schema_version.length <= 16 &&
    (b.state === undefined || ["active", "completed", "cancelled", "failed"].includes(String(b.state))) &&
    typeof b.payload === "object" &&
    b.payload !== null &&
    !Array.isArray(b.payload)
  );
}

/**
 * Check whether a schema version is supported.
 */
export function isSupportedVersion(version: string): boolean {
  return SUPPORTED_VERSIONS.has(version);
}

/**
 * Extract adaptive card blocks from a message's content_blocks.
 */
export function extractCardBlocks(contentBlocks: unknown): AdaptiveCardBlock[] {
  if (!Array.isArray(contentBlocks)) return [];
  return contentBlocks
    .filter(isAdaptiveCardBlock)
    .map((block) => block.state === undefined ? { ...block, state: "active" } : block);
}

export function normalizeAdaptiveCardAction(action: any): AdaptiveCardActionInfo {
  // Read type/title/url/data directly from the live action object.
  // Avoid calling action.toJSON() here — the SDK serialization reads from
  // _propertyBag (original parse data), not the post-prepare _processedData
  // that carries merged input values.  Accessing the live getters ensures we
  // capture the user's actual input selections.
  const type =
    (typeof action?.getJsonTypeName === "function" ? action.getJsonTypeName() : "") ||
    action?.constructor?.name ||
    "Unknown";
  const title =
    (typeof action?.title === "string" ? action.title : "") || "";
  const url =
    (typeof action?.url === "string" ? action.url : "") || undefined;
  const data = action?.data ?? undefined;
  return { type, title, data, url, raw: action };
}

function formatSubmissionValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    return value.map((item) => formatSubmissionValue(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const pairs = Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key}: ${formatSubmissionValue(inner)}`)
      .filter((entry) => !entry.endsWith(": "));
    return pairs.join(", ");
  }
  return String(value).trim();
}

function coerceInputValue(type: unknown, value: unknown, definition?: Record<string, unknown>): unknown {
  if (value == null) return value;
  if (type === "Input.Toggle") {
    if (typeof value === "boolean") {
      if (value) return definition?.valueOn ?? "true";
      return definition?.valueOff ?? "false";
    }
    return typeof value === "string" ? value : String(value);
  }
  if (type === "Input.ChoiceSet") {
    if (Array.isArray(value)) return value.join(",");
    return typeof value === "string" ? value : String(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return formatSubmissionValue(value);
  return typeof value === "string" ? value : String(value);
}

export function sanitizeAdaptiveCardPayloadForReadOnly(
  payload: Record<string, unknown>,
  rewriteResourceUrl?: (value: string) => string,
): Record<string, unknown> {
  const rewrite = (value: unknown): string | null => {
    if (typeof value !== "string" || typeof rewriteResourceUrl !== "function") return null;
    const result = rewriteResourceUrl(value);
    return typeof result === "string" && result.trim() ? result.trim() : null;
  };
  const sanitizeText = (value: string): string => value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt) => String(alt || ''))
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_match, alt) => String(alt || ''))
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, '');
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map((item) => visit(item));
    if (!node || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    const cardType = typeof record.type === "string" ? record.type : "";
    if (cardType.startsWith("Input.")) {
      const label = typeof record.label === "string" ? sanitizeText(record.label) : "";
      const value = record.value == null ? "" : sanitizeText(String(record.value));
      const text = [label, value].filter(Boolean).join(": ") || "Input unavailable";
      return { type: "TextBlock", text, wrap: true, isSubtle: true };
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase();
      if (["action", "actions", "inlineaction", "selectaction", "refresh", "authentication"].includes(normalizedKey)) continue;
      if (normalizedKey === "url" || normalizedKey === "iconurl" || normalizedKey === "poster") {
        const rewritten = rewrite(value);
        if (rewritten) sanitized[key] = rewritten;
        continue;
      }
      if (normalizedKey === "backgroundimage" && typeof value === "string") {
        const rewritten = rewrite(value);
        if (rewritten) sanitized[key] = rewritten;
        continue;
      }
      sanitized[key] = typeof value === "string" ? sanitizeText(value) : visit(value);
    }
    return sanitized;
  };
  return visit(payload) as Record<string, unknown>;
}

export function rewriteAdaptiveCardPayloadResources(
  payload: Record<string,unknown>,rewriteResourceUrl?: (value:string)=>string,
):Record<string,unknown>{
  const visit=(value:unknown,key=""):unknown=>{
    if(Array.isArray(value))return value.map(item=>visit(item,key));
    if(!value||typeof value!=="object"){
      if(typeof value==="string"&&["url","iconurl","poster","backgroundimage"].includes(key.toLowerCase())&&rewriteResourceUrl){const rewritten=rewriteResourceUrl(value);return rewritten?.trim()?rewritten:undefined;}
      return value;
    }
    return Object.fromEntries(Object.entries(value as Record<string,unknown>).flatMap(([innerKey,inner])=>{const rewritten=visit(inner,innerKey);return rewritten===undefined?[]:[[innerKey,rewritten]];}));
  };
  return visit(payload) as Record<string,unknown>;
}

export function sanitizeAdaptiveCardRenderedResources(
  root: HTMLElement,
  rewriteResourceUrl?: (value: string) => string,
  disableLinks = true,
): void {
  const rewrite = (value: string | null): string | null => {
    if (!value || typeof rewriteResourceUrl !== "function") return null;
    const result = rewriteResourceUrl(value);
    return typeof result === "string" && result.trim() ? result.trim() : null;
  };
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const element of nodes) {
    const tag = element.tagName.toLowerCase();
    if (tag === "a" && disableLinks) {
      element.removeAttribute("href");
      element.removeAttribute("target");
      element.removeAttribute("rel");
      element.setAttribute("aria-disabled", "true");
      element.setAttribute("tabindex", "-1");
    }
    for (const attribute of ["src", "poster", "data"]) {
      if (!element.hasAttribute(attribute)) continue;
      const rewritten = rewrite(element.getAttribute(attribute));
      if (rewritten) element.setAttribute(attribute, rewritten);
      else element.removeAttribute(attribute);
    }
    element.removeAttribute("srcset");
    if (["image", "use", "feimage"].includes(tag)) {
      for (const attribute of ["href", "xlink:href"]) {
        if (!element.hasAttribute(attribute)) continue;
        const rewritten = rewrite(element.getAttribute(attribute));
        if (rewritten) element.setAttribute(attribute, rewritten);
        else element.removeAttribute(attribute);
      }
    }
    const style = element.getAttribute("style");
    if (!style || !/url\s*\(/i.test(style)) continue;
    let allowed = true;
    const rewrittenStyle = style.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_match, quote, value) => {
      const rewritten = rewrite(String(value).trim());
      if (!rewritten) { allowed = false; return ""; }
      return `url(${quote || '"'}${rewritten}${quote || '"'})`;
    });
    if (allowed) element.setAttribute("style", rewrittenStyle);
    else element.removeAttribute("style");
  }
}

export function hydrateAdaptiveCardPayloadWithSubmission(
  payload: Record<string, unknown>,
  submission: unknown,
): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return payload;
  if (!submission || typeof submission !== "object" || Array.isArray(submission)) return payload;

  const values = submission as Record<string, unknown>;

  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map((item) => visit(item));
    if (!node || typeof node !== "object") return node;

    const record = node as Record<string, unknown>;
    const hydrated: Record<string, unknown> = { ...record };

    if (typeof hydrated.id === "string" && hydrated.id in values && String(hydrated.type || "").startsWith("Input.")) {
      hydrated.value = coerceInputValue(hydrated.type, values[hydrated.id], hydrated);
    }

    for (const [key, value] of Object.entries(hydrated)) {
      if (Array.isArray(value) || (value && typeof value === "object")) {
        hydrated[key] = visit(value);
      }
    }

    return hydrated;
  };

  return visit(payload) as Record<string, unknown>;
}

function formatAdaptiveCardTimestamp(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function describeAdaptiveCardState(block: AdaptiveCardBlock): { label: string; detail: string | null } | null {
  if (block.state === "active") return null;

  const label = block.state === "completed"
    ? "Submitted"
    : block.state === "cancelled"
      ? "Cancelled"
      : "Failed";

  const submission = block.last_submission && typeof block.last_submission === "object"
    ? (block.last_submission as Record<string, unknown>)
    : null;
  const title = submission && typeof submission.title === "string" ? submission.title.trim() : "";
  const when = formatAdaptiveCardTimestamp(block.completed_at || (submission?.submitted_at as string | undefined));
  const detail = [title || null, when || null].filter(Boolean).join(" · ") || null;

  return { label, detail };
}

/**
 * Render an Adaptive Card into a container element.
 *
 * Returns true if the card was rendered successfully, false on failure.
 * On failure, the caller should fall back to text rendering.
 */
export async function renderAdaptiveCard(
  container: HTMLElement,
  block: AdaptiveCardBlock,
  options?: {
    /** Called when a card action is executed (Phase 2). */
    onAction?: (action: AdaptiveCardActionInfo) => void | Promise<void>;
    /** Render the standard card presentation without allowing any action. */
    readOnly?: boolean;
    /** Restrict indirect card resources when rendering without actions. */
    rewriteResourceUrl?: (value: string) => string;
  },
): Promise<boolean> {
  if (!isSupportedVersion(block.schema_version)) {
    console.warn(
      `[adaptive-card] Unsupported schema version ${block.schema_version} for card ${block.card_id}`,
    );
    return false;
  }

  try {
    await ensureSdk();
  } catch (err) {
    console.error("[adaptive-card] Failed to load SDK:", err);
    return false;
  }

  try {
    const AC = getAC();
    ensureAdaptiveCardMarkdownProcessor(AC);
    const card = new AC.AdaptiveCard();

    // Apply HostConfig from current theme
    const themeValues = getAdaptiveCardThemeValues();
    card.hostConfig = new AC.HostConfig(buildHostConfig());

    // Parse the card payload. Finished cards are hydrated with the last
    // submitted values first so the rendered card itself shows what was chosen.
    const submissionData = block.last_submission && typeof block.last_submission === "object"
      ? (block.last_submission as Record<string, unknown>).data
      : undefined;
    const hydratedPayload = block.state === "active"
      ? block.payload
      : hydrateAdaptiveCardPayloadWithSubmission(block.payload, submissionData);
    const payload = options?.readOnly
      ? sanitizeAdaptiveCardPayloadForReadOnly(hydratedPayload, options.rewriteResourceUrl)
      : options?.rewriteResourceUrl
        ? rewriteAdaptiveCardPayloadResources(hydratedPayload,options.rewriteResourceUrl)
        : hydratedPayload;
    card.parse(payload);

    // Wire up action handler (Phase 2)
    card.onExecuteAction = options?.readOnly ? () => {} : (action: any) => {
      const normalizedAction = normalizeAdaptiveCardAction(action);
      if (options?.onAction) {
        clearAdaptiveCardNotice(container);
        container.classList.add("adaptive-card-busy");
        void Promise.resolve(options.onAction(normalizedAction)).catch((error) => {
          console.error("[adaptive-card] Action failed:", error);
          const message = error instanceof Error ? error.message : String(error || "Action failed.");
          showAdaptiveCardNotice(container, message || "Action failed.", "error");
        }).finally(() => {
          container.classList.remove("adaptive-card-busy");
        });
      }
    };

    // Render
    const rendered = card.render();
    if (!rendered) {
      console.warn(`[adaptive-card] Card ${block.card_id} rendered to null`);
      return false;
    }

    // Style the container
    container.classList.add("adaptive-card-container");
    container.style.setProperty("--adaptive-card-button-text-color", themeValues.buttonTextColor);

    const stateMeta = describeAdaptiveCardState(block);
    if (stateMeta) {
      container.classList.add("adaptive-card-finished");
      const banner = document.createElement("div");
      banner.className = `adaptive-card-status adaptive-card-status-${block.state}`;

      const label = document.createElement("span");
      label.className = "adaptive-card-status-label";
      label.textContent = stateMeta.label;
      banner.appendChild(label);

      if (stateMeta.detail) {
        const detail = document.createElement("span");
        detail.className = "adaptive-card-status-detail";
        detail.textContent = stateMeta.detail;
        banner.appendChild(detail);
      }

      container.appendChild(banner);
    }

    clearAdaptiveCardNotice(container);
    if (options?.rewriteResourceUrl) sanitizeAdaptiveCardRenderedResources(rendered, options.rewriteResourceUrl,options?.readOnly!==false);
    container.appendChild(rendered);
    if (stateMeta || options?.readOnly) {
      lockAdaptiveCardInputs(rendered);
    }
    return true;
  } catch (err) {
    console.error(`[adaptive-card] Failed to render card ${block.card_id}:`, err);
    return false;
  }
}
