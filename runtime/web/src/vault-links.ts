const URI_PREFIX = 'obsidian:////workspace/vaults/learning/';
const PATH_PREFIX = '//workspace/vaults/learning/';

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Return a safe canonical learning-vault Obsidian link or null. */
export function sanitizeVaultHref(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 4_096 || !raw.toLowerCase().startsWith(URI_PREFIX)) return null;
  const rawPath = (raw.split('#', 1)[0] || '').slice(URI_PREFIX.length);
  if (/%(?:2f|5c)/i.test(rawPath)) return null;
  try {
    if (decodeURIComponent(rawPath).split('/').some((segment) => segment === '.' || segment === '..')) return null;
  } catch { return null; }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'obsidian:' || url.host || url.username || url.password || url.port || url.search || !url.pathname.startsWith(PATH_PREFIX)) return null;
    let path = decodeURIComponent(url.pathname.slice(PATH_PREFIX.length));
    const heading = url.hash ? decodeURIComponent(url.hash.slice(1)) : '';
    if (!path || path.length > 2_048 || path.includes('\\') || containsControlCharacter(path)) return null;
    const segments = path.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    if (heading && (heading.length > 512 || containsControlCharacter(heading))) return null;
    path = path.replace(/\.md$/i, '');
    return `${URI_PREFIX}${path.split('/').map((segment) => encodeURIComponent(segment)).join('/')}${heading ? `#${encodeURIComponent(heading)}` : ''}`;
  } catch { return null; }
}

export function vaultLinkLabel(href: string): string {
  const safe = sanitizeVaultHref(href);
  if (!safe) return 'Learning note';
  try {
    const url = new URL(safe);
    return decodeURIComponent(url.pathname.split('/').pop() || '') || 'Learning note';
  } catch { return 'Learning note'; }
}

export function dispatchVaultViewerOpen(target: EventTarget, value: unknown): boolean {
  const href = sanitizeVaultHref(value);
  if (!href || typeof (target as EventTarget | null)?.dispatchEvent !== 'function') return false;
  target.dispatchEvent(new CustomEvent('vault-viewer:open-tab', {
    bubbles: true,
    detail: { path: href, label: vaultLinkLabel(href) },
  }));
  return true;
}

export function handleVaultLinkClick(event: MouseEvent, container: HTMLElement): boolean {
  const target = event.target as Element | null;
  const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!anchor || !container.contains(anchor)) return false;
  const href = sanitizeVaultHref(anchor.getAttribute('href'));
  if (!href) return false;
  event.preventDefault();
  event.stopPropagation();
  return dispatchVaultViewerOpen(container, href);
}
