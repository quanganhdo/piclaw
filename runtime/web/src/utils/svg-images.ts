import { readSvgPalette, type SvgPalette, type SvgSurface } from '../ui/svg-theme.js';
/** Bounded, deliberately small SVG image subset. Never insert model SVG into the host DOM. */
export const SVG_IMAGE_LIMITS = Object.freeze({ bytes: 256 * 1024, nodes: 2048, depth: 32, dimension: 2048 });
const NS = 'http://www.w3.org/2000/svg';
const ELEMENTS = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath']);
const LENGTHS = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'dx', 'dy', 'stroke-width', 'stroke-dashoffset', 'font-size']);
const NUMBERS = new Set(['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'stroke-miterlimit', 'offset']);
const ENUMS: Record<string, readonly string[]> = {
  'fill-rule': ['nonzero', 'evenodd'], 'clip-rule': ['nonzero', 'evenodd'],
  'stroke-linecap': ['butt', 'round', 'square'], 'stroke-linejoin': ['miter', 'round', 'bevel'],
  'text-anchor': ['start', 'middle', 'end'], 'dominant-baseline': ['auto', 'middle', 'central', 'hanging', 'text-before-edge', 'text-after-edge', 'alphabetic'],
  'font-family': ['sans-serif', 'serif', 'monospace'], 'font-weight': ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
  'font-style': ['normal', 'italic', 'oblique'], gradientUnits: ['objectBoundingBox', 'userSpaceOnUse'],
  clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'], spreadMethod: ['pad', 'reflect', 'repeat'],
};
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const FRAGMENT = /^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,63})\)$/;

export function encodeSvgSource(text: string): string {
  let binary = ''; for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeSvgSource(text: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(text), (char) => char.charCodeAt(0)));
}

export function escapeSvgSource(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function finiteNumber(value: string): boolean {
  return NUMBER.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1_000_000;
}

function numbers(value: string): number[] | null {
  const parts = value.trim().split(/[\s,]+/);
  return parts.length && parts.every(finiteNumber) ? parts.map(Number) : null;
}

function safeAttribute(name: string, value: string): boolean {
  if (name === 'id') return /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(value);
  if (LENGTHS.has(name)) return finiteNumber(value.replace(/(?:px|%)$/, ''));
  if (NUMBERS.has(name)) return finiteNumber(value.replace(/%$/, ''));
  if (Object.hasOwn(ENUMS, name)) return ENUMS[name].includes(value);
  if (['fill', 'stroke', 'color', 'stop-color'].includes(name)) {
    return /^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%+,\s/-]+\))$/i.test(value) || FRAGMENT.test(value);
  }
  if (name === 'clip-path') return value === 'none' || FRAGMENT.test(value);
  if (name === 'viewBox') { const parts = numbers(value); return !!parts && parts.length === 4 && parts[2] > 0 && parts[3] > 0; }
  if (name === 'points' || name === 'stroke-dasharray') return value === 'none' || numbers(value) !== null;
  if (name === 'd') return /^[MmZzLlHhVvCcSsQqTtAa\dEe+.,\s-]*$/.test(value);
  if (name === 'transform' || name === 'gradientTransform') {
    const rest = value.replace(/(?:matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/g, (match, args) => numbers(args) ? '' : match);
    return rest.trim() === '';
  }
  return false; // No href, styles, animation, event handlers, namespaces or arbitrary CSS.
}

type SvgImage = Readonly<{ src: string; label: string }>;
// Share a small bounded cache across both skins, including bounded invalid inputs.
// Do not retain oversized input or DOM nodes. Hits avoid XML parsing during rerenders.
const cache = new Map<string, { image: SvgImage | null; size: number }>();
const CACHE_ENTRIES = 8;
const CACHE_BYTES = 2 * 1024 * 1024;
let cacheBytes = 0;

export function sanitizeSvgImage(source: string, surface: SvgSurface = 'theme'): SvgImage | null {
  if (source.length > SVG_IMAGE_LIMITS.bytes) return null;
  const palette = readSvgPalette(surface);
  const key = JSON.stringify(palette) + source;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit.image; }
  const image = parseSvgImage(source, palette);
  const size = 2 * (key.length + (image?.src.length || 0) + (image?.label.length || 0));
  if (size <= CACHE_BYTES) {
    while (cache.size >= CACHE_ENTRIES || cacheBytes + size > CACHE_BYTES) {
      const oldest = cache.keys().next().value!;
      cacheBytes -= cache.get(oldest)!.size;
      cache.delete(oldest);
    }
    cache.set(key, { image, size }); cacheBytes += size;
  }
  return image;
}

function parseSvgImage(source: string, palette: SvgPalette): SvgImage | null {
  // Check cheap code-unit bound before allocating encoded bytes or invoking XML parsing.
  if (source.length > SVG_IMAGE_LIMITS.bytes || new TextEncoder().encode(source).byteLength > SVG_IMAGE_LIMITS.bytes) return null;
  if (/<!\s*(?:DOCTYPE|ENTITY)|<\?/i.test(source)) return null;
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror') || doc.doctype) return null;

  // Bound original XML nodes/depth, including content that would otherwise be removed.
  const pending: Array<{ node: Node; depth: number }> = [{ node: root, depth: 1 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > SVG_IMAGE_LIMITS.nodes || depth > SVG_IMAGE_LIMITS.depth) return null;
    for (let child = node.lastChild; child; child = child.previousSibling) {
      if (count + pending.length >= SVG_IMAGE_LIMITS.nodes) return null;
      pending.push({ node: child, depth: depth + (child.nodeType === 1 ? 1 : 0) });
    }
  }

  const output = document.implementation.createDocument(NS, 'svg', null);
  const ids = new Map<string, Element>();
  const refs: Array<{ element: Element; name: string; id: string }> = [];
  function copy(input: Element, target: Element, inDefinition: boolean): boolean {
    // Omitted xmlns on the root is common in model output; normalise that one
    // whole-document form. Explicit namespace resets and mixed namespaces reject.
    if (input.hasAttribute('xmlns') && input.getAttribute('xmlns') !== NS) return false;
    if (input.namespaceURI !== root.namespaceURI || (input.namespaceURI && input.namespaceURI !== NS) || input.prefix || !ELEMENTS.has(input.localName)) return false;
    if (input !== root && input.localName === 'svg') return false;
    const definition = inDefinition || ['defs', 'clipPath', 'linearGradient', 'radialGradient'].includes(input.localName);
    for (const attr of Array.from(input.attributes)) {
      if (attr.namespaceURI || attr.prefix) continue;
      const name = attr.name;
      let value = attr.value.trim();
      if (['fill','stroke','color','stop-color'].includes(name)) {
        const token = value.match(/^var\(--svg-(background|foreground|muted|accent|border|surface|success|warning|danger)\)$/);
        if (token) value = palette[token[1] as keyof SvgPalette];
      }
      if (!safeAttribute(name, value)) continue;
      const ref = value.match(FRAGMENT);
      if (ref) {
        if (definition || !['fill', 'stroke', 'clip-path'].includes(name)) continue;
        refs.push({ element: target, name, id: ref[1] });
      }
      if (name === 'id') { if (ids.has(value)) return false; ids.set(value, target); }
      target.setAttribute(name, value);
    }
    for (const child of Array.from(input.childNodes)) {
      if (child.nodeType === 1) {
        const el = child as Element;
        if (!ELEMENTS.has(el.localName)) return false;
        const next = output.createElementNS(NS, el.localName);
        if (!copy(el, next, definition)) return false;
        target.appendChild(next);
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        target.appendChild(output.createTextNode(child.nodeValue || ''));
      } else if (child.nodeType !== 8) return false;
    }
    return true;
  }
  if (!copy(root, output.documentElement, false)) return null;
  for (const ref of refs) {
    const tag = ids.get(ref.id)?.localName;
    if (!(ref.name === 'clip-path' ? tag === 'clipPath' : tag === 'linearGradient' || tag === 'radialGradient')) ref.element.removeAttribute(ref.name);
  }
  const clean = output.documentElement;
  if (!clean.hasAttribute('color')) clean.setAttribute('color', palette.foreground);
  if (!clean.hasAttribute('fill')) clean.setAttribute('fill', 'currentColor');
  const box = numbers(clean.getAttribute('viewBox') || '');
  const dimension = (name: string, fallback: number) => {
    const raw = clean.getAttribute(name)?.replace(/px$/, '') || '';
    return finiteNumber(raw) && Number(raw) > 0 ? Number(raw) : fallback;
  };
  const width = dimension('width', box?.[2] || 300), height = dimension('height', box?.[3] || 150);
  const scale = Math.min(1, SVG_IMAGE_LIMITS.dimension / Math.max(width, height));
  clean.setAttribute('width', String(width * scale));
  clean.setAttribute('height', String(height * scale));
  if (!box) clean.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clean.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const label = (clean.querySelector('title')?.textContent?.trim() || clean.querySelector('desc')?.textContent?.trim() || 'Model-generated SVG').replace(/\s+/g, ' ').slice(0, 256);
  return Object.freeze({ src: `data:image/svg+xml;base64,${encodeSvgSource(new XMLSerializer().serializeToString(clean))}`, label });
}

/** Extract only top-level SVG fences before entity decoding, preserving source bytes for copy. */
export function renderSvgFences(
  text: string,
  renderMarkdown: (text: string) => string,
  renderSource: (source: string) => string,
  options: { sanitize?: boolean } = {},
): string {
  if (!/^ {0,3}(?:`{3,}|~{3,})svg\s*$/im.test(text)) return renderMarkdown(text);
  const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean) || [];
  let fence: { char: string; length: number } | null = null;
  let frontmatter = /^(?:\uFEFF)?---(?:\r?\n|\r)/.test(text);
  let last = 0;
  const output: string[] = [];
  const replacements: string[] = [];
  const prefix = `PICLAWSVG${Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('')}BLOCK`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[\r\n]+$/, '');
    if (frontmatter) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false; continue; }
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!open) continue;
    fence = { char: open[1][0], length: open[1].length };
    if (!/^svg\s*$/i.test(open[2])) continue;
    const close = new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end].replace(/[\r\n]+$/, ''))) end++;
    if (i > last) output.push(lines.slice(last, i).join(''));
    const source = lines.slice(i + 1, end).join('');
    const image = options.sanitize === false ? null : end < lines.length ? sanitizeSvgImage(source) : null;
    const code = renderSource(source);
    output.push(`\n\n${prefix}${replacements.length}END\n\n`);
    replacements.push(options.sanitize === false && end < lines.length
      ? source
      : image
        ? `<div class="model-svg-block" data-svg-surface="theme"><div class="model-svg-controls"><label>SVG background <select class="model-svg-surface" aria-label="SVG background"><option value="theme">Theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><img class="model-svg-image" src="${image.src}" alt="${escapeSvgSource(image.label)}"><details class="model-svg-source"><summary>SVG source</summary>${code}</details></div>`
        : code);
    i = end; last = end + 1; fence = null;
  }
  if (!replacements.length) return renderMarkdown(text);
  if (last < lines.length) output.push(lines.slice(last).join(''));
  // Keep one Markdown parse so reference links and surrounding blocks retain context.
  // Unpredictable markers cannot collide with model text or raw-HTML attributes.
  const html = renderMarkdown(output.join(''));
  return html.replace(new RegExp(`(?:<p>)?${prefix}(\\d+)END(?:<\\/p>)?`, 'g'), (_match, index) => replacements[Number(index)]);
}

/** Host-created controls only. Read source from the existing exact-copy block;
 * never inject model SVG into host DOM, even when changing preview surfaces. */
export function bindSvgImageThemes(container:HTMLElement):()=>void {
  const blocks=Array.from(container.querySelectorAll<HTMLElement>('.model-svg-block'));
  if(!blocks.length)return()=>{};
  const refresh=(block:HTMLElement)=>{
    const surface=block.dataset.svgSurface as SvgSurface;
    const image=block.querySelector<HTMLImageElement>('.model-svg-image');
    const code=block.querySelector<HTMLElement>('[data-svg-source], .code-block__copy[data-code]');
    if(!image||!code)return;
    const next=sanitizeSvgImage(decodeSvgSource(code.dataset.svgSource||code.dataset.code||''),surface);
    if(next&&image.getAttribute('src')!==next.src)image.src=next.src;
  };
  const onTheme=()=>blocks.forEach(block=>{if(block.dataset.svgSurface==='theme')refresh(block);});
  const onChange=(event:Event)=>{const select=event.target as HTMLSelectElement;if(!select?.matches('.model-svg-surface'))return;const block=select.closest<HTMLElement>('.model-svg-block');if(!block||!['theme','light','dark'].includes(select.value))return;block.dataset.svgSurface=select.value;refresh(block);};
  container.addEventListener('change',onChange);window.addEventListener('piclaw-theme-change',onTheme);
  onTheme();
  return()=>{container.removeEventListener('change',onChange);window.removeEventListener('piclaw-theme-change',onTheme);};
}
