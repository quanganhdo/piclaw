const COLLECTION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DOC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}(?::\d+(?::\d+)?)?$/;
const PATH_RANGE_RE = /^(.*\.md)(?::\d+(?::\d+)?)?$/i;

/** Return a safe canonical QMD link or null when the reference is malformed. */
export function sanitizeQmdHref(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 4_096 || !/^qmd:/i.test(raw)) return null;

  const opaqueId = raw.match(/^qmd:#(.+)$/i);
  if (opaqueId) return DOC_ID_RE.test(opaqueId[1] || '') ? `qmd:#${opaqueId[1]}` : null;

  const authorityEnd = raw.indexOf('/', raw.indexOf('://') + 3);
  if (authorityEnd >= 0) {
    const rawPath = raw.slice(authorityEnd + 1).split(/[?#]/, 1)[0] || '';
    try {
      if (decodeURIComponent(rawPath).split('/').some((segment) => segment === '.' || segment === '..')) return null;
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'qmd:' || url.username || url.password || url.port || url.search || url.hash) return null;
    const collection = decodeURIComponent(url.hostname);
    const decodedPath = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (collection.toLowerCase() === 'doc') {
      const idWithRange = decodedPath.replace(/^#/, '');
      if (!DOC_ID_RE.test(idWithRange)) return null;
      const suffix = idWithRange.match(/:\d+(?::\d+)?$/)?.[0] || '';
      const id = suffix ? idWithRange.slice(0, -suffix.length) : idWithRange;
      return `qmd://doc/%23${encodeURIComponent(id)}${suffix}`;
    }
    if (!COLLECTION_RE.test(collection) || !PATH_RANGE_RE.test(decodedPath)) return null;
    if (decodedPath.includes('\\') || /[\u0000-\u001f\u007f]/.test(decodedPath)) return null;
    const pathWithoutRange = decodedPath.replace(/:\d+(?::\d+)?$/, '');
    const segments = pathWithoutRange.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    const suffix = decodedPath.slice(pathWithoutRange.length);
    return `qmd://${collection}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}${suffix}`;
  } catch {
    return null;
  }
}

export function qmdLinkLabel(href: string): string {
  const safe = sanitizeQmdHref(href);
  if (!safe) return 'QMD Document';
  if (/^qmd:#/i.test(safe)) return safe.slice(4).replace(/:\d+(?::\d+)?$/, '');
  try {
    const url = new URL(safe);
    const name = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/:\d+(?::\d+)?$/, '');
    return name || 'QMD Document';
  } catch {
    return 'QMD Document';
  }
}

/** Ask the app shell to resolve a validated QMD reference through the pane registry. */
export function dispatchQmdViewerOpen(target: EventTarget, value: unknown): boolean {
  const href = sanitizeQmdHref(value);
  if (!href || typeof (target as EventTarget | null)?.dispatchEvent !== 'function') return false;
  target.dispatchEvent(new CustomEvent('pane:open-tab', {
    bubbles: true,
    detail: { path: href, label: qmdLinkLabel(href) },
  }));
  return true;
}

/** Intercept a rendered QMD citation and ask the app shell to resolve its pane. */
export function handleQmdLinkClick(event: MouseEvent, container: HTMLElement): boolean {
  const target = event.target as Element | null;
  const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!anchor || !container.contains(anchor)) return false;
  const href = sanitizeQmdHref(anchor.getAttribute('href'));
  if (!href) return false;
  event.preventDefault();
  event.stopPropagation();
  return dispatchQmdViewerOpen(container, href);
}
