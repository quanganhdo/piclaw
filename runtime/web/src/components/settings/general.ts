import { html, useState, useEffect, useCallback, useMemo, useRef } from '../../vendor/preact-htm.js';
import { METERS_EVENT_NAME, applyMetersEnabled, readStoredMetersEnabled } from '../../ui/meters.js';
import { NumberStepper } from './number-stepper.js';
import { useTranslation } from '../../utils/i18n.js';

export function resolveAvatarPreview(value, kind) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    // Newly selected files have not reached the avatar cache yet, so preview
    // their browser-local URL directly. Persisted sources must use the avatar
    // endpoint: /workspace/file is a JSON metadata API, not image content.
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    return kind === 'agent' || kind === 'user' ? `/avatar/${kind}` : '';
}

function AvatarField({ value, kind, onChange }) {
    const { t } = useTranslation();
    const inputRef = useRef(null);
    const [preview, setPreview] = useState(resolveAvatarPreview(value, kind));

    useEffect(() => { setPreview(resolveAvatarPreview(value, kind)); }, [kind, value]);

    const handleFileSelect = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            setPreview(dataUrl);
            onChange?.(dataUrl);
        };
        reader.readAsDataURL(file);
    }, [onChange]);

    return html`
        <div class="settings-avatar-inline" onClick=${() => inputRef.current?.click()} title=${t('settings.general.avatarUpload')}>
            ${preview
                ? html`<img src=${preview} alt="avatar" />`
                : html`<span class="settings-avatar-placeholder">+</span>`}
            <input type="file" accept="image/*" ref=${inputRef} style="display:none" onChange=${handleFileSelect} />
        </div>
    `;
}

function normalizeGeneralSettings(data: Record<string, any> = {}) {
    return {
        userName: data.userName || '',
        userAvatar: data.userAvatar || '',
        assistantName: data.assistantName || '',
        assistantAvatar: data.assistantAvatar || '',
        composeUploadLimitMb: data.composeUploadLimitMb ?? 32,
        workspaceUploadLimitMb: data.workspaceUploadLimitMb ?? 256,
        automaticRecoveryEnabled: data.automaticRecoveryEnabled ?? true,
        automaticRecoveryMaxAttempts: data.automaticRecoveryMaxAttempts ?? 0,
        automaticRecoveryTotalBudgetMs: data.automaticRecoveryTotalBudgetMs ?? 0,
    };
}

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
            console.debug('[settings/general] Clipboard API write failed; falling back to execCommand.', error);
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
    } catch (_error) {
        return false;
    }
}

export function GeneralSection({ settingsData, setStatus, mergeSettingsData }) {
    const { t } = useTranslation();
    const [userName, setUserName] = useState('');
    const [userAvatar, setUserAvatar] = useState('');
    const [assistantName, setAssistantName] = useState('');
    const [assistantAvatar, setAssistantAvatar] = useState('');
    const [composeUploadLimitMb, setComposeUploadLimitMb] = useState(32);
    const [workspaceUploadLimitMb, setWorkspaceUploadLimitMb] = useState(256);
    const [automaticRecoveryEnabled, setAutomaticRecoveryEnabled] = useState(true);
    const [automaticRecoveryMaxAttempts, setAutomaticRecoveryMaxAttempts] = useState(0);
    const [automaticRecoveryTotalBudgetMs, setAutomaticRecoveryTotalBudgetMs] = useState(0);
    const [widgetToken, setWidgetToken] = useState('');
    const [widgetTokenRevealed, setWidgetTokenRevealed] = useState(false);
    const [widgetTokenCopied, setWidgetTokenCopied] = useState(false);
    const [widgetTokenBusy, setWidgetTokenBusy] = useState(false);
    const [metersEnabled, setMetersEnabled] = useState(() => readStoredMetersEnabled(false));
    const [appliedHint, setAppliedHint] = useState(false);
    const savedSnapshotRef = useRef('');
    const saveTimerRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const applyIncoming = useCallback((data) => {
        const next = normalizeGeneralSettings(data);
        setUserName(next.userName);
        setUserAvatar(next.userAvatar);
        setAssistantName(next.assistantName);
        setAssistantAvatar(next.assistantAvatar);
        setComposeUploadLimitMb(next.composeUploadLimitMb);
        setWorkspaceUploadLimitMb(next.workspaceUploadLimitMb);
        setAutomaticRecoveryEnabled(next.automaticRecoveryEnabled);
        setAutomaticRecoveryMaxAttempts(next.automaticRecoveryMaxAttempts);
        setAutomaticRecoveryTotalBudgetMs(next.automaticRecoveryTotalBudgetMs);
        setWidgetToken(data?.widgetToken || '');
        savedSnapshotRef.current = JSON.stringify(next);
    }, []);

    useEffect(() => {
        applyIncoming(settingsData || {});
    }, [settingsData, applyIncoming]);

    useEffect(() => {
        const onMetersChange = (event) => {
            setMetersEnabled(Boolean(event?.detail?.enabled));
        };
        window.addEventListener(METERS_EVENT_NAME, onMetersChange);
        return () => window.removeEventListener(METERS_EVENT_NAME, onMetersChange);
    }, []);

    const currentSnapshot = useMemo(() => JSON.stringify(normalizeGeneralSettings({
        userName, userAvatar, assistantName, assistantAvatar,
        composeUploadLimitMb, workspaceUploadLimitMb,
        automaticRecoveryEnabled, automaticRecoveryMaxAttempts, automaticRecoveryTotalBudgetMs,
    })), [
        userName, userAvatar, assistantName, assistantAvatar,
        composeUploadLimitMb, workspaceUploadLimitMb,
        automaticRecoveryEnabled, automaticRecoveryMaxAttempts, automaticRecoveryTotalBudgetMs,
    ]);

    useEffect(() => {
        if (currentSnapshot === savedSnapshotRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            if (!mountedRef.current) return;
            try {
                const response = await fetch('/agent/settings/general', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: currentSnapshot,
                });
                const payload = await response.json().catch(() => ({}));
                if (!mountedRef.current) return;
                if (!response.ok || !payload?.ok || !payload?.settings) {
                    throw new Error(payload?.error || `Failed to save general settings (${response.status})`);
                }
                savedSnapshotRef.current = currentSnapshot;
                mergeSettingsData?.(payload.settings);
                setStatus?.(null);
                setAppliedHint(true);
                setTimeout(() => { if (mountedRef.current) setAppliedHint(false); }, 4000);
            } catch (error) {
                console.warn('[settings/general] Failed to persist general settings snapshot.', error);
                if (mountedRef.current) setStatus?.(String(error?.message || error), 'error');
            }
        }, 800);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [currentSnapshot, mergeSettingsData, setStatus]);

    const totpSetup = settingsData?.instanceTotp || {
        configured: false,
        issuer: assistantName || 'Piclaw',
        label: userName ? `${assistantName || 'Piclaw'}:${userName}` : (assistantName || 'Piclaw'),
        secret: '',
        otpauth: '',
        qrSvg: '',
    };

    const copyWidgetToken = useCallback(async () => {
        if (!widgetToken) return;
        const copied = await writeSettingsClipboardText(widgetToken);
        if (copied) {
            setWidgetTokenCopied(true);
            setTimeout(() => { if (mountedRef.current) setWidgetTokenCopied(false); }, 3000);
        } else {
            setStatus?.(t('settings.general.copyFailed'));
            console.warn('[settings/general] Failed to copy widget token. Clipboard APIs unavailable or blocked.');
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
            console.warn('[settings/general] Failed to regenerate widget token.', error);
        } finally {
            if (mountedRef.current) setWidgetTokenBusy(false);
        }
    }, [widgetTokenBusy, mergeSettingsData]);

    const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;
    const maskedWidgetToken = widgetToken ? '•'.repeat(Math.min(Math.max(widgetToken.length, 16), 48)) : '—';
    const widgetTokenDisplay = widgetTokenRevealed ? (widgetToken || '—') : maskedWidgetToken;

    return html`
        <div class="settings-section">
            ${appliedHint && html`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${t('settings.appliedNotice')}
                </div>
            `}
            <h3>${t('settings.general.identity')}</h3>
            <div class="settings-row">
                <label>${t('settings.general.userLabel')}</label>
                <${AvatarField} kind="user" value=${userAvatar} onChange=${setUserAvatar} />
                <input type="text" value=${userName} onInput=${e => setUserName(e.target.value)} placeholder=${t('settings.general.yourName')} />
            </div>
            <div class="settings-row">
                <label>${t('settings.general.agentLabel')}</label>
                <${AvatarField} kind="agent" value=${assistantAvatar} onChange=${setAssistantAvatar} />
                <input type="text" value=${assistantName} onInput=${e => setAssistantName(e.target.value)} placeholder=${t('settings.general.agentName')} />
            </div>

            <h3 style="margin-top:20px">${t('settings.general.notifications')}</h3>
            ${isSecureContext ? html`
                <div class="settings-row">
                    <label>${t('settings.general.browserNotifications')}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0">
                            ${t('settings.general.notifSecureHint')}
                        </span>
                    </div>
                </div>
            ` : html`
                <div class="settings-row">
                    <label>${t('settings.general.browserNotifications')}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0; color: var(--error-color, #e55)">
                            ${t('settings.general.notifInsecureHint')}
                        </span>
                    </div>
                </div>
            `}

            <h3 style="margin-top:20px">${t('settings.general.display')}</h3>
            <div class="settings-row">
                <label>${t('settings.general.systemMeters')}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${metersEnabled}
                        onChange=${() => {
                            const next = applyMetersEnabled(!metersEnabled);
                            setMetersEnabled(next);
                        }} />
                    <span class="settings-hint" style="margin:0">${t('settings.general.systemMetersHint')}</span>
                </div>
            </div>

            <h3 style="margin-top:20px">${t('settings.general.instanceConfig')}</h3>
            <div class="settings-row">
                <label>${t('settings.general.composeUpload')}</label>
                <${NumberStepper}
                    label=${t('settings.general.composeUploadAria')}
                    value=${composeUploadLimitMb}
                    min=${1}
                    max=${512}
                    fallback=${32}
                    width="80px"
                    onChange=${setComposeUploadLimitMb}
                />
                <span class="settings-hint" style="margin:0">${t('settings.general.composeUploadHint')}</span>
            </div>
            <div class="settings-row">
                <label>${t('settings.general.workspaceUpload')}</label>
                <${NumberStepper}
                    label=${t('settings.general.workspaceUploadAria')}
                    value=${workspaceUploadLimitMb}
                    min=${1}
                    max=${1024}
                    fallback=${256}
                    width="80px"
                    onChange=${setWorkspaceUploadLimitMb}
                />
                <span class="settings-hint" style="margin:0">${t('settings.general.workspaceUploadHint')}</span>
            </div>

            <h3 style="margin-top:20px">${t('settings.general.agentRecovery')}</h3>
            <div class="settings-row">
                <label>${t('settings.general.automaticRecovery')}</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" checked=${automaticRecoveryEnabled}
                        onChange=${e => setAutomaticRecoveryEnabled(Boolean(e.target.checked))} />
                    <span class="settings-hint" style="margin:0">${t('settings.general.automaticRecoveryHint')}</span>
                </div>
            </div>
            <div class="settings-row">
                <label>${t('settings.general.recoveryMaxAttempts')}</label>
                <${NumberStepper}
                    label=${t('settings.general.recoveryMaxAttemptsAria')}
                    value=${automaticRecoveryMaxAttempts}
                    min=${0}
                    step=${1}
                    fallback=${0}
                    width="90px"
                    onChange=${setAutomaticRecoveryMaxAttempts}
                />
                <span class="settings-hint" style="margin:0">${t('settings.general.recoveryMaxAttemptsHint')}</span>
            </div>
            <div class="settings-row">
                <label>${t('settings.general.recoveryTotalBudget')}</label>
                <${NumberStepper}
                    label=${t('settings.general.recoveryTotalBudgetAria')}
                    value=${automaticRecoveryTotalBudgetMs}
                    min=${0}
                    step=${1000}
                    fallback=${0}
                    width="110px"
                    onChange=${setAutomaticRecoveryTotalBudgetMs}
                />
                <span class="settings-hint" style="margin:0">${t('settings.general.recoveryTotalBudgetHint')} ${automaticRecoveryTotalBudgetMs === 0 && Number.isFinite(settingsData?.automaticRecoveryEffectiveBudgetMs) ? t('settings.general.recoveryEffectiveBudget', { budget: settingsData.automaticRecoveryEffectiveBudgetMs }) : ''}</span>
            </div>

            <h3 style="margin-top:20px">${t('settings.general.authentication')}</h3>
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
            <div class="settings-totp-panel">
                <div class="settings-totp-header">
                    <div>
                        <strong>${t('settings.general.totpTitle')}</strong>
                        <div class="settings-hint" style="margin:6px 0 0 0;">
                            ${totpSetup.configured
                                ? t('settings.general.totpConfiguredHint')
                                : t('settings.general.totpUnconfiguredHint')}
                        </div>
                    </div>
                </div>
                ${totpSetup.configured ? html`
                    <div class="settings-totp-grid">
                        <div class="settings-totp-qr" dangerouslySetInnerHTML=${{ __html: totpSetup.qrSvg }}></div>
                        <div class="settings-totp-meta">
                            <div class="settings-row settings-row-vertical">
                                <label>${t('settings.general.issuer')}</label>
                                <input type="text" readonly value=${totpSetup.issuer || ''} />
                            </div>
                            <div class="settings-row settings-row-vertical">
                                <label>${t('settings.general.label')}</label>
                                <input type="text" readonly value=${totpSetup.label || ''} />
                            </div>
                            <div class="settings-row settings-row-vertical">
                                <label>${t('settings.general.secret')}</label>
                                <input type="text" readonly value=${totpSetup.secret || ''} />
                            </div>
                        </div>
                    </div>
                ` : null}
            </div>
        </div>
    `;
}
