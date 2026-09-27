import { html, useState, useEffect, useCallback, useRef } from '../../vendor/preact-htm.js';
import { useTranslation } from '../../utils/i18n.js';

export async function writeSettingsClipboardText(value, runtime: any = {}) {
    const text = typeof value === 'string' ? value : '';
    if (!text) return false;

    const nav = runtime.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
    const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);

    if (nav?.clipboard?.writeText) {
        try {
            await nav.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.debug('[settings/api-access] Clipboard API write failed; falling back to execCommand.', error);
        }
    }

    try {
        if (!doc?.body || typeof doc.createElement !== 'function' || typeof doc.execCommand !== 'function') return false;
        const textarea = doc.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute?.('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        textarea.style.opacity = '0';
        doc.body.appendChild(textarea);
        textarea.focus?.();
        textarea.select?.();
        const copied = Boolean(doc.execCommand('copy'));
        doc.body.removeChild(textarea);
        return copied;
    } catch {
        return false;
    }
}

export function ApiAccessSection({ settingsData, setStatus, mergeSettingsData }) {
    const { t } = useTranslation();
    const [widgetToken, setWidgetToken] = useState('');
    const [widgetTokenRevealed, setWidgetTokenRevealed] = useState(false);
    const [widgetTokenCopied, setWidgetTokenCopied] = useState(false);
    const [widgetTokenBusy, setWidgetTokenBusy] = useState(false);
    const [appliedHint, setAppliedHint] = useState(false);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    useEffect(() => { setWidgetToken(settingsData?.widgetToken || ''); }, [settingsData?.widgetToken]);
    const copyWidgetToken = useCallback(async () => {
        if (!widgetToken) return;
        const copied = await writeSettingsClipboardText(widgetToken);
        if (copied) {
            setWidgetTokenCopied(true);
            setTimeout(() => { if (mountedRef.current) setWidgetTokenCopied(false); }, 3000);
        } else {
            setStatus?.(t('settings.general.copyFailed'));
            console.warn('[settings/api-access] Failed to copy widget token. Clipboard APIs unavailable or blocked.');
        }
    }, [widgetToken, setStatus]);

    const regenerateWidgetToken = useCallback(async () => {
        if (widgetTokenBusy) return;
        if (!confirm(t('settings.general.regenConfirm'))) return;
        setWidgetTokenBusy(true);
        try {
            const response = await fetch('/agent/settings/widget-token/regenerate', { method: 'POST' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok || !payload?.settings) throw new Error(payload?.error || 'Failed to regenerate widget token.');
            setWidgetToken(payload.settings.widgetToken || '');
            mergeSettingsData?.(payload.settings);
            setAppliedHint(true);
            setTimeout(() => { if (mountedRef.current) setAppliedHint(false); }, 4000);
        } catch (error) {
            console.warn('[settings/api-access] Failed to regenerate widget token.', error);
            if (mountedRef.current) setStatus?.(String(error?.message || error), 'error');
        } finally {
            if (mountedRef.current) setWidgetTokenBusy(false);
        }
    }, [widgetTokenBusy, mergeSettingsData, setStatus]);


    const maskedWidgetToken = widgetToken ? '•'.repeat(Math.min(Math.max(widgetToken.length, 16), 48)) : '—';
    const widgetTokenDisplay = widgetTokenRevealed ? (widgetToken || '—') : maskedWidgetToken;
    return html`
        <div class="settings-section">
            <h3>${t('settings.section.api-access')}</h3>
            ${appliedHint && html`<div class="settings-general-applied-notice" role="status" aria-live="polite">${t('settings.appliedNotice')}</div>`}
            <div class="settings-row settings-row-vertical settings-widget-token-row">
                <label>${t('settings.general.widgetToken')}</label>
                <div class="settings-keychain-reveal-panel settings-widget-token-panel">
                    <div class="settings-keychain-reveal-field settings-widget-token-field">
                        <span class="settings-keychain-reveal-label">${t('settings.general.token')}</span>
                        <code class="settings-keychain-reveal-value settings-widget-token-value">${widgetTokenDisplay}</code>
                        <button class=${`settings-keychain-reveal-btn${widgetTokenRevealed ? ' active' : ''}`}
                            type="button"
                            onClick=${() => setWidgetTokenRevealed(value => !value)}
                            disabled=${!widgetToken}
                            title=${widgetTokenRevealed ? t('settings.general.hideToken') : t('settings.general.revealToken')}>
                            ${widgetTokenRevealed
                                ? html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
                                : html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
                            }
                        </button>
                        <button class="settings-keychain-copy-btn" type="button" onClick=${copyWidgetToken} disabled=${!widgetToken} title=${t('settings.general.copyToken')}>
                            ${widgetTokenCopied
                                ? html`<span class="settings-widget-token-copied">${t('settings.general.copied')}</span>`
                                : html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
                            }
                        </button>
                        <button class="settings-keychain-prompt-submit settings-widget-token-regenerate" type="button" onClick=${regenerateWidgetToken} disabled=${widgetTokenBusy}>${widgetTokenBusy ? t('settings.general.regenerating') : t('settings.general.regenerate')}</button>
                    </div>
                </div>
                <span class="settings-hint" style="margin:6px 0 0 0;">
                    ${t('settings.general.tokenHintPre')} <code>GET /api/state</code> ${t('settings.general.tokenHintMid')} <code>GET /api/state/events</code>${t('settings.general.tokenHintPost')} <code>Authorization: Bearer …</code>${t('settings.general.tokenHintEnd')}
                </span>
            </div>
        </div>
    `;
}
