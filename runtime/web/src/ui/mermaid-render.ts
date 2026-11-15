/** Shared timeline diagram lifecycle for Classic, Visual and the scoped Family view. */

export interface DiagramRenderer { render(source: string): string; sanitize(svg: string): string }
declare global { var piclawDiagrams: DiagramRenderer | undefined; interface Window { piclawDiagrams?: DiagramRenderer } }

let loadPromise: Promise<void> | null = null;
const rendering = new WeakSet<Element>();

function ensureRenderer(): Promise<void> {
  if (window.piclawDiagrams) return Promise.resolve();
  if (loadPromise) return loadPromise;
  const script = document.createElement('script');
  script.src = '/static/common/js/vendor/pele.js';
  loadPromise = new Promise<void>((resolve, reject) => {
    script.onload = () => window.piclawDiagrams ? resolve() : reject(new Error('Mermaid library failed to load'));
    script.onerror = () => reject(new Error('Mermaid library failed to load'));
    document.head.append(script);
  }).catch((error) => {
    script.remove();
    loadPromise = null;
    throw error;
  });
  return loadPromise;
}

export function isMermaidSourceAllowedForScopedRendering(source: string): boolean {
  if (/(?:https?:\/\/|data:|blob:|\/\/)/i.test(source)) return false;
  const references = Array.from(source.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi), (match) => match[2]?.trim() || '');
  return references.every((reference) => /^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(reference));
}

function decodeSource(encoded: string): string {
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  let current = new TextDecoder().decode(bytes);
  for (let i = 0; i < 2; i++) {
    const safe = current.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const decoded = new DOMParser().parseFromString(safe, 'text/html').documentElement.textContent || '';
    if (current === decoded) break;
    current = decoded;
  }
  return current;
}

export async function renderMermaidDiagrams(container: HTMLElement, options: {
  scoped?: boolean;
  reportError?: (error: unknown) => void;
} = {}): Promise<void> {
  const pending = Array.from(container.querySelectorAll<HTMLElement>('.mermaid-container[data-mermaid]'));
  // Claim before awaiting the load: streaming observers and post effects can overlap.
  const claimed = pending.filter((el) => !rendering.has(el));
  for (const el of claimed) rendering.add(el);
  if (!claimed.length) return;
  try {
    await ensureRenderer();
    for (const el of claimed) {
      // Streaming may update the source while the bundle loads. Render the latest bytes.
      const encoded = el.dataset.mermaid;
      if (!container.contains(el) || encoded === undefined) continue;
      try {
        const source = decodeSource(encoded);
        if (options.scoped && !isMermaidSourceAllowedForScopedRendering(source)) {
          throw new Error('External Mermaid resources are unavailable in this view.');
        }
        const svg = window.piclawDiagrams!.render(source);
        const sanitize = window.piclawDiagrams!.sanitize;
        if (typeof sanitize !== 'function') throw new Error('Diagram sanitizer is unavailable');
        el.innerHTML = sanitize(svg);
        el.removeAttribute('data-mermaid');
      } catch (error) {
        showError(el, error);
      }
    }
  } catch (error) {
    for (const el of claimed) {
      if (container.contains(el) && el.hasAttribute('data-mermaid')) showError(el, error);
    }
  } finally {
    for (const el of claimed) rendering.delete(el);
  }
  function showError(el: HTMLElement, error: unknown) {
    options.reportError?.(error);
    const pre = document.createElement('pre');
    pre.className = 'mermaid-error';
    pre.textContent = 'Diagram error: ' + (error instanceof Error ? error.message : String(error));
    el.replaceChildren(pre);
    el.removeAttribute('data-mermaid');
  }
}
