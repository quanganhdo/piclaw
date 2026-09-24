import { html, useEffect, useRef } from '../../vendor/preact-htm.js';
import { h, render } from 'preact';
import { PasskeySettings } from '../../../shared/passkey-settings.js';

/** Separate Preact root: Classic's vendored hooks must not mix with Visual hooks. */
export function AuthenticationSection() {
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    render(h(PasskeySettings, {}), element);
    return () => render(null, element);
  }, []);
  return html`<section class="settings-section"><h2>Authentication</h2><div ref=${root} /></section>`;
}
