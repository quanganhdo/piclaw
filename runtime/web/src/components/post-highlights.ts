/**
 * post-highlights.ts — Persistent text highlighting for timeline posts.
 *
 * Lets the user select text in a post, tap "Highlight" to mark it with
 * a colored background. Highlights are stored in the message's own
 * `annotations` field in the database via PATCH /post/:id/annotations.
 *
 * Re-application uses textContent offset matching, which is resilient
 * to HTML re-rendering as long as the text content is stable.
 */

import { savePostAnnotations } from '../api.js';

// ── Types ───────────────────────────────────────────────────────

export interface PostHighlight {
  type: 'highlight';
  text: string;
  textOffset: number;
  color: string;
}

export interface PostAside {
  type: 'aside';
  text: string;
  textOffset: number;
  note: string;
}

export type PostAnnotation = PostHighlight | PostAside;

// ── Highlight colors ────────────────────────────────────────────

export const HIGHLIGHT_COLORS = [
  { name: 'yellow',  value: 'rgba(250, 204, 21, 0.4)' },
  { name: 'green',   value: 'rgba(74, 222, 128, 0.35)' },
  { name: 'blue',    value: 'rgba(96, 165, 250, 0.35)' },
  { name: 'pink',    value: 'rgba(244, 114, 182, 0.35)' },
  { name: 'orange',  value: 'rgba(251, 146, 60, 0.35)' },
];

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0]!.value;

export function buildHighlightFromSelectionSnapshot(
  snapshot: { text: string; textOffset: number } | null | undefined,
  color: string,
): PostHighlight | null {
  if (!snapshot || typeof snapshot.text !== 'string' || typeof snapshot.textOffset !== 'number') return null;
  if (!snapshot.text) return null;
  return {
    type: 'highlight',
    text: snapshot.text,
    textOffset: snapshot.textOffset,
    color,
  };
}

// ── Read highlights from post data ──────────────────────────────

export function extractHighlightsFromAnnotations(annotations: unknown[] | undefined | null): PostHighlight[] {
  if (!Array.isArray(annotations)) return [];
  return annotations.filter(
    (a): a is PostHighlight =>
      a != null &&
      typeof a === 'object' &&
      (a as any).type === 'highlight' &&
      typeof (a as any).text === 'string' &&
      typeof (a as any).textOffset === 'number' &&
      typeof (a as any).color === 'string',
  );
}

export function extractAsidesFromAnnotations(annotations: unknown[] | undefined | null): PostAside[] {
  if (!Array.isArray(annotations)) return [];
  return annotations.filter(
    (a): a is PostAside =>
      a != null &&
      typeof a === 'object' &&
      (a as any).type === 'aside' &&
      typeof (a as any).text === 'string' &&
      typeof (a as any).textOffset === 'number' &&
      typeof (a as any).note === 'string',
  );
}

// ── Save highlights via API ─────────────────────────────────────

export async function persistHighlight(
  postId: number,
  chatJid: string,
  existingAnnotations: unknown[] | undefined | null,
  highlight: PostHighlight,
): Promise<unknown[]> {
  const current = Array.isArray(existingAnnotations) ? [...existingAnnotations] : [];
  // Dedupe
  const exists = current.some(
    (a: any) =>
      a?.type === 'highlight' &&
      a?.text === highlight.text &&
      a?.textOffset === highlight.textOffset,
  );
  if (!exists) current.push(highlight);
  await savePostAnnotations(postId, current, chatJid);
  return current;
}

export async function persistAside(
  postId: number,
  chatJid: string,
  existingAnnotations: unknown[] | undefined | null,
  aside: PostAside,
): Promise<unknown[]> {
  const current = Array.isArray(existingAnnotations) ? [...existingAnnotations] : [];
  const exists = current.some(
    (a: any) =>
      a?.type === 'aside' &&
      a?.text === aside.text &&
      a?.textOffset === aside.textOffset,
  );
  if (!exists) current.push(aside);
  await savePostAnnotations(postId, current, chatJid);
  return current;
}


// ── Remove annotations via API ──────────────────────────────────

export async function removeAnnotationAtIndex(
  postId: number,
  chatJid: string,
  existingAnnotations: unknown[] | undefined | null,
  index: number,
): Promise<unknown[]> {
  const current = Array.isArray(existingAnnotations) ? [...existingAnnotations] : [];
  if (index < 0 || index >= current.length) return current;
  current.splice(index, 1);
  await savePostAnnotations(postId, current, chatJid);
  return current;
}

// ── DOM application ─────────────────────────────────────────────

function collectTextNodes(root: Node): { node: Text; offset: number }[] {
  const result: { node: Text; offset: number }[] = [];
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip text inside injected annotation elements (pills, aside content)
      const parent = node.parentElement;
      if (parent?.closest('.post-aside-pill, .post-aside-content')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    result.push({ node, offset });
    offset += node.textContent?.length ?? 0;
  }
  return result;
}

function resolveAbsoluteOffset(
  textNodes: { node: Text; offset: number }[],
  container: Node | null,
  localOffset: number,
): number {
  if (!container || container.nodeType !== Node.TEXT_NODE) return -1;
  const entry = textNodes.find(({ node }) => node === container);
  if (!entry) return -1;
  const nodeLength = entry.node.textContent?.length ?? 0;
  const bounded = Math.max(0, Math.min(localOffset, nodeLength));
  return entry.offset + bounded;
}

/**
 * Apply saved highlights to a DOM element by wrapping matched text
 * ranges in <mark> elements. Call after innerHTML is set.
 */
export function applyHighlightsToElement(
  element: HTMLElement,
  highlights: PostHighlight[],
): void {
  if (!highlights.length) return;
  const fullText = element.textContent ?? '';

  const sorted = highlights
    .filter((h) => {
      const found = fullText.substring(h.textOffset, h.textOffset + h.text.length);
      return found === h.text;
    })
    .sort((a, b) => b.textOffset - a.textOffset);

  for (const highlight of sorted) {
    const textNodes = collectTextNodes(element);
    wrapTextRange(textNodes, highlight.textOffset, highlight.text.length, highlight.color);
  }
}

function wrapTextRange(
  textNodes: { node: Text; offset: number }[],
  targetOffset: number,
  length: number,
  color: string,
): void {
  let remaining = length;
  let started = false;

  for (const { node, offset: nodeOffset } of textNodes) {
    const nodeLen = node.textContent?.length ?? 0;
    const nodeEnd = nodeOffset + nodeLen;

    if (!started) {
      if (targetOffset >= nodeOffset && targetOffset < nodeEnd) {
        started = true;
        const localStart = targetOffset - nodeOffset;
        const localEnd = Math.min(nodeLen, localStart + remaining);
        const wrapped = localEnd - localStart;
        wrapPartOfTextNode(node, localStart, localEnd, color);
        remaining -= wrapped;
        if (remaining <= 0) return;
      }
    } else {
      const localEnd = Math.min(nodeLen, remaining);
      wrapPartOfTextNode(node, 0, localEnd, color);
      remaining -= localEnd;
      if (remaining <= 0) return;
    }
  }
}

function wrapPartOfTextNode(
  node: Text,
  start: number,
  end: number,
  color: string,
): void {
  const text = node.textContent ?? '';
  if (start >= end || start >= text.length) return;

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, Math.min(end, text.length));

  const mark = document.createElement('mark');
  mark.className = 'post-highlight';
  mark.style.backgroundColor = color;
  mark.style.borderRadius = '2px';
  mark.style.padding = '0 1px';

  try {
    range.surroundContents(mark);
  } catch {
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
  }
}

// ── Selection helpers ───────────────────────────────────────────

type PostSelectionSubscription = {
  notify: () => void;
};

const postSelectionSubscriptions = new WeakMap<HTMLElement, PostSelectionSubscription>();
let postSelectionSubscriberCount = 0;
let activePostSelectionElement: HTMLElement | null = null;

function resolvePostSelectionElement(): HTMLElement | null {
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
  const postContent = anchorElement?.closest?.('.post-content');
  return postContent instanceof HTMLElement && postSelectionSubscriptions.has(postContent)
    ? postContent
    : null;
}

function notifyPostSelectionChange(): void {
  const nextElement = resolvePostSelectionElement();
  if (activePostSelectionElement && activePostSelectionElement !== nextElement) {
    postSelectionSubscriptions.get(activePostSelectionElement)?.notify();
  }
  if (nextElement) postSelectionSubscriptions.get(nextElement)?.notify();
  activePostSelectionElement = nextElement;
}

/**
 * Share one document-level selection listener across every rendered post.
 * Selection work is routed only to the post that owns the selection (and the
 * previously active post when its popup needs dismissing), instead of walking
 * every historical post on each editor cursor movement.
 */
export function subscribePostSelectionChanges(element: HTMLElement, notify: () => void): () => void {
  const subscription = { notify };
  postSelectionSubscriptions.set(element, subscription);
  postSelectionSubscriberCount += 1;
  if (postSelectionSubscriberCount === 1) {
    document.addEventListener('selectionchange', notifyPostSelectionChange);
  }

  return () => {
    if (postSelectionSubscriptions.get(element) !== subscription) return;
    postSelectionSubscriptions.delete(element);
    postSelectionSubscriberCount = Math.max(0, postSelectionSubscriberCount - 1);
    if (activePostSelectionElement === element) activePostSelectionElement = null;
    if (postSelectionSubscriberCount === 0) {
      document.removeEventListener('selectionchange', notifyPostSelectionChange);
    }
  };
}

export function getSelectionInElement(element: HTMLElement): {
  text: string;
  textOffset: number;
  rect: DOMRect;
} | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const range = sel.getRangeAt(0)!;
  if (!element.contains(range.commonAncestorContainer)) return null;

  const fullText = sel.toString();
  if (!fullText) return null;

  const textNodes = collectTextNodes(element);
  if (!textNodes.length) return null;

  const rawStartOffset = resolveAbsoluteOffset(textNodes, range.startContainer, range.startOffset);
  const rawEndOffset = resolveAbsoluteOffset(textNodes, range.endContainer, range.endOffset);
  if (rawStartOffset < 0 || rawEndOffset < 0 || rawEndOffset <= rawStartOffset) return null;

  // Keep user intent for multi-line ranges (including list bullets/newlines),
  // but trim only edge whitespace so persistence and matching stay stable.
  const leadingTrim = fullText.match(/^\s*/)?.[0].length ?? 0;
  const trailingTrim = fullText.match(/\s*$/)?.[0].length ?? 0;
  const text = fullText.slice(leadingTrim, Math.max(leadingTrim, fullText.length - trailingTrim));
  if (!text) return null;

  const textOffset = rawStartOffset + leadingTrim;

  const rect = range.getBoundingClientRect();
  return { text, textOffset, rect };
}

export interface HighlightPopupPlacement {
  left: number;
  top: number;
}

/** Keep the desktop annotation toolbar near the selection without clipping. */
export function resolveHighlightPopupPlacement(
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  viewport: { width: number; height: number },
  popup: { width?: number; height?: number } = {},
): HighlightPopupPlacement {
  const margin = 8;
  const gap = 8;
  const width = Math.max(1, popup.width ?? 180);
  const height = Math.max(1, popup.height ?? 40);
  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const selectionCenter = (rect.left + rect.right) / 2;
  const left = Math.min(maxLeft, Math.max(margin, selectionCenter - width / 2));
  const above = rect.top - height - gap;
  const below = rect.bottom + gap;
  const maxTop = Math.max(margin, viewport.height - height - margin);
  const top = above >= margin ? above : Math.min(maxTop, Math.max(margin, below));
  return { left, top };
}

export function hasCoarseAnnotationPointer(runtime: Pick<Window, 'matchMedia'> | null | undefined): boolean {
  if (!runtime?.matchMedia) return false;
  return Boolean(runtime.matchMedia('(pointer: coarse)').matches);
}

// ── Aside DOM application ───────────────────────────────────────

/**
 * Apply aside annotations to a DOM element. Inserts a tappable pill
 * marker (⋯) after the anchored text range. Clicking reveals/hides
 * the aside note in an inline <aside> element.
 */
export function applyAsidesToElement(
  element: HTMLElement,
  asides: PostAside[],
): void {
  if (!asides.length) return;
  const fullText = element.textContent ?? '';

  const sorted = asides
    .filter((a) => {
      const found = fullText.substring(a.textOffset, a.textOffset + a.text.length);
      return found === a.text;
    })
    .sort((a, b) => b.textOffset - a.textOffset);

  for (const aside of sorted) {
    const textNodes = collectTextNodes(element);
    insertAsideMarker(element, textNodes, aside);
  }
}

function insertAsideMarker(
  root: HTMLElement,
  textNodes: { node: Text; offset: number }[],
  aside: PostAside,
): void {
  const targetEnd = aside.textOffset + aside.text.length;

  // Find the text node containing the end of the anchored range
  for (const { node, offset: nodeOffset } of textNodes) {
    const nodeLen = node.textContent?.length ?? 0;
    const nodeEnd = nodeOffset + nodeLen;

    if (targetEnd > nodeOffset && targetEnd <= nodeEnd) {
      const localEnd = targetEnd - nodeOffset;

      // Split the text node at the end of the anchor
      if (localEnd < nodeLen) {
        node.splitText(localEnd);
      }

      // Create the pill marker
      const pill = root.ownerDocument.createElement('span');
      pill.className = 'post-aside-pill';
      pill.setAttribute('data-aside-note', aside.note);
      pill.setAttribute('title', aside.note);
      pill.textContent = '\u22ef'; // ⋯
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = pill.nextElementSibling;
        if (existing?.classList.contains('post-aside-content')) {
          existing.remove();
        } else {
          const asideEl = root.ownerDocument.createElement('aside');
          asideEl.className = 'post-aside-content';
          asideEl.textContent = aside.note;
          pill.after(asideEl);
        }
      });

      // Insert pill after the text node (at the end of the anchor)
      node.after(pill);
      return;
    }
  }
}
