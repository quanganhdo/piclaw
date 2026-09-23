/** Instance install branding. Contains no chat/user identity or private source paths. */
export function applyBrandingIconLinks(documentLike: { getElementById?: (id: string) => any } | null | undefined, version: string | number): void {
  if (!documentLike?.getElementById) return;
  const buster = encodeURIComponent(String(version || 'default'));
  const paths: Record<string, string> = {
    'dynamic-manifest': '/manifest.json',
    'dynamic-favicon': '/favicon.ico',
    'dynamic-apple-touch-icon': '/apple-touch-icon.png',
    'dynamic-apple-touch-icon-180': '/apple-touch-icon-180x180.png',
    'dynamic-apple-touch-icon-167': '/apple-touch-icon-167x167.png',
    'dynamic-apple-touch-icon-152': '/apple-touch-icon-152x152.png',
    'dynamic-apple-touch-icon-precomposed': '/apple-touch-icon-precomposed.png',
  };
  for (const [id, path] of Object.entries(paths)) {
    const link = documentLike.getElementById(id);
    const href = `${path}?v=${buster}`;
    if (link && (link.getAttribute?.('href') ?? link.href) !== href) link.href = href;
  }
}

export function avatarRevision(avatar: unknown): string {
  if (typeof avatar !== 'string' || !avatar) return 'default';
  return new URL(avatar, 'http://instance.invalid').searchParams.get('v') || 'unversioned';
}

let brandingGeneration = 0;
export function applyInstanceBranding(payload: any): void {
  if (typeof document === 'undefined' || (payload?.agent_id && payload.agent_id !== 'default')) return;
  brandingGeneration++;
  if (typeof payload?.agent_name === 'string') {
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', payload.agent_name.trim() || 'PiClaw');
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'agent_avatar')) applyBrandingIconLinks(document, avatarRevision(payload.agent_avatar));
}

/** Reconnect/cold-start hydration uses the already-public manifest, also in family mode. */
export async function refreshInstanceBranding(): Promise<void> {
  const generation = ++brandingGeneration;
  try {
    const response = await fetch('/manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    if (generation !== brandingGeneration) return;
    applyInstanceBranding({ agent_id: 'default', agent_name: manifest.name, agent_avatar: manifest.piclaw_avatar ?? null });
  } catch (error) {
    console.debug('Instance branding refresh unavailable', error);
  }
}
