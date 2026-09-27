/** Browser chrome and standalone safe-area canvas share one resolved background. */
let repaintFrame: number | null = null;

export function isAppleStandalone(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    const apple = /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return apple && (Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
        || Boolean(window.matchMedia?.('(display-mode: standalone)').matches));
}

function setMeta(name: string, content: string, id?: string) {
    let meta = (id ? document.getElementById(id) : document.querySelector(`meta[name="${name}"]`)) as HTMLMetaElement | null;
    if (!meta) { meta = document.createElement('meta'); document.head.appendChild(meta); }
    meta.setAttribute('name', name);
    if (id) meta.setAttribute('id', id);
    if (meta.getAttribute('content') !== content) meta.setAttribute('content', content);
    return meta;
}

export function applyThemeChrome(color: string): void {
    if (typeof document === 'undefined' || !color) return;
    document.documentElement.style.background = color;
    if (document.body) document.body.style.background = color;
    setMeta('theme-color', color, 'dynamic-theme-color').removeAttribute('media');
    // The chosen palette can deliberately disagree with the OS colour scheme.
    // Keep legacy media-qualified tags consistent, not alternate theme choices.
    setMeta('theme-color', color, 'theme-color-light').setAttribute('media', '(prefers-color-scheme: light)');
    setMeta('theme-color', color, 'theme-color-dark').setAttribute('media', '(prefers-color-scheme: dark)');
    setMeta('msapplication-TileColor', color);
    setMeta('msapplication-navbutton-color', color);
    // This is a viewport contract, not a palette toggle. Switching it at runtime
    // changes iOS standalone safe-area treatment; a light theme still needs it.
    setMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    if (!isAppleStandalone() || document.hidden || typeof window.requestAnimationFrame !== 'function') return;
    if (repaintFrame !== null) window.cancelAnimationFrame(repaintFrame);
    repaintFrame = window.requestAnimationFrame(() => {
        repaintFrame = null;
        if (document.hidden) return;
        const meta = document.getElementById('dynamic-theme-color');
        // Reinsert the *current* value after style application, signalling Safari
        // to resample its chrome. No body transforms, scroll nudges or polling.
        if (meta?.parentNode) meta.replaceWith(meta.cloneNode(true));
    });
}

/** Refresh the already active palette, including custom imports, on restoration. */
export function refreshThemeChrome(): void {
    if (typeof document === 'undefined' || document.hidden) return;
    const root = document.documentElement;
    const color = getComputedStyle(root).getPropertyValue('--bg-primary').trim() || root.style.backgroundColor;
    if (color) applyThemeChrome(color);
}

export function watchThemeChrome(): () => void {
    const refresh = () => refreshThemeChrome();
    const cancel = () => {
        if (repaintFrame !== null) window.cancelAnimationFrame(repaintFrame);
        repaintFrame = null;
    };
    const visibility = () => document.hidden ? cancel() : refresh();
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
        window.removeEventListener('pageshow', refresh);
        document.removeEventListener('visibilitychange', visibility);
        cancel();
    };
}
