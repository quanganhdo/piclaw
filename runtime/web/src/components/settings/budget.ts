import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import { getBudgetSettings, updateBudgetSettings } from '../../api.js';
import {
    BUDGET_METRIC_LABELS,
    BUDGET_SCOPE_LABELS,
    budgetEvidenceState,
    buildBudgetSaveRequest,
    capToBudgetDraft,
    defaultBudgetCapDraft,
    formatBudgetAmount,
    formatBudgetDate,
    normalizeBudgetCapDraft,
    requestBudgetSettingsSection,
} from '../../ui/budget-settings-model.js';

function resolveChatJid() {
    try {
        return new URL(window.location.href).searchParams.get('chat_jid')?.trim() || (window as any).__piclawCurrentChatJid || 'web:default';
    } catch {
        return 'web:default';
    }
}

function Pill({ state = 'neutral', children }) {
    return html`<span class=${`settings-budget-pill settings-budget-pill-${state}`}>${children}</span>`;
}

export function BudgetSection({ setStatus }) {
    const [payload, setPayload] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState(() => defaultBudgetCapDraft());
    const [showForm, setShowForm] = useState(false);
    const [allowance, setAllowance] = useState({ cap_id: '', amount: '', expires_at: '' });
    const createButtonRef = useRef(null);
    const formHeadingRef = useRef(null);
    const chatJid = useMemo(resolveChatJid, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const next = await getBudgetSettings(chatJid);
            setPayload(next);
            setDraft(current => current.id ? current : defaultBudgetCapDraft(next));
        } catch (nextError) {
            setError(nextError?.message || 'Budget settings could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [chatJid]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { if (showForm) requestAnimationFrame(() => formHeadingRef.current?.focus()); }, [showForm]);

    const mutate = useCallback(async (body, success) => {
        if (busy) return null;
        setBusy(true);
        setError('');
        setStatus?.('Saving budget policy…', 'info');
        try {
            const next = await updateBudgetSettings(body, chatJid);
            setPayload(next);
            setStatus?.(success, 'success');
            return next;
        } catch (nextError) {
            const message = nextError?.message || 'Budget action failed.';
            setError(message);
            setStatus?.(message, 'error');
            return null;
        } finally {
            setBusy(false);
        }
    }, [busy, chatJid, setStatus]);

    const updateDraft = useCallback((patch) => setDraft(current => normalizeBudgetCapDraft({ ...current, ...patch }, payload || {})), [payload]);

    const openCreate = useCallback(() => {
        setDraft(defaultBudgetCapDraft(payload || {}));
        setShowForm(true);
    }, [payload]);

    const editCap = useCallback((cap) => {
        setDraft(capToBudgetDraft(cap, payload || {}));
        setShowForm(true);
    }, [payload]);

    const closeForm = useCallback(() => {
        setShowForm(false);
        setDraft(defaultBudgetCapDraft(payload || {}));
        requestAnimationFrame(() => createButtonRef.current?.focus());
    }, [payload]);

    const saveCap = useCallback(async (event) => {
        event.preventDefault();
        let body;
        try { body = buildBudgetSaveRequest(draft, payload || {}); }
        catch (nextError) { setError(nextError.message); return; }
        if (draft.confirm_revision && !window.confirm(`Update ${draft.id} revision ${draft.confirm_revision}? Existing window spend and audit history will remain.`)) return;
        const next = await mutate(body, draft.id ? `Updated ${draft.id}.` : 'Budget cap created.');
        if (next) closeForm();
    }, [closeForm, draft, mutate, payload]);

    const toggleCap = useCallback(async (cap) => {
        const verb = cap.enabled ? 'Disable' : 'Enable';
        if (!window.confirm(`${verb} ${cap.id}? Existing spend, windows and audit history will remain.`)) return;
        await mutate({ action: 'set_cap_enabled', id: cap.id, enabled: !cap.enabled, confirm_revision: cap.revision }, `${verb}d ${cap.id}.`);
    }, [mutate]);

    const pausedBlockers = payload?.decision?.blockers || [];
    const work = payload?.work;

    return html`
        <div class="settings-section settings-budget-section">
            <div class="settings-budget-intro">
                <div><h3>Budget</h3><p>${payload?.pricing_notice || 'API-equivalent USD is an estimate, not an invoice or subscription balance.'}</p></div>
                <button ref=${createButtonRef} type="button" class="settings-secondary-btn" onClick=${openCreate} disabled=${busy || loading}>Create cap</button>
            </div>
            <p class="settings-hint">${payload?.reservation_notice || 'Budget limits v1 does not reserve spend and never selects a cheaper model automatically.'}</p>
            <p class="settings-hint"><strong>Enforcement:</strong> ${payload?.enforcement === 'best_effort_boundaries' ? 'Best effort at boundaries Piclaw controls.' : 'Unknown.'}</p>

            ${loading && html`<div class="settings-loading settings-loading-pane" role="status"><span class="settings-spinner"></span><span>Loading budget policy…</span></div>`}
            ${error && html`<div class="settings-error-state" role="alert">${error} <button type="button" onClick=${load}>Retry</button></div>`}

            ${showForm && html`
                <form class="settings-budget-form" onSubmit=${saveCap}>
                    <h4 ref=${formHeadingRef} tabindex="-1">${draft.id ? `Edit ${draft.id}` : 'Create budget cap'}</h4>
                    <div class="settings-budget-form-grid">
                        <label>Scope<select value=${draft.scope} onChange=${event => updateDraft({ scope: event.target.value })}>
                            ${work && html`<option value="task">Current work</option>`}
                            <option value="instance_daily">Daily instance</option>
                            <option value="instance_monthly">Monthly instance</option>
                            <option value="provider_window">Provider guard</option>
                        </select></label>
                        <label>Amount<input required inputmode="decimal" value=${draft.amount} onInput=${event => updateDraft({ amount: event.target.value })} placeholder="10.00" /></label>
                        ${(draft.scope === 'instance_daily' || draft.scope === 'instance_monthly') && html`<label>Timezone<input required value=${draft.timezone} onInput=${event => updateDraft({ timezone: event.target.value })} /></label>`}
                        ${draft.scope === 'provider_window' && html`
                            <label>Provider<select value=${draft.provider_id} onChange=${event => updateDraft({ provider_id: event.target.value })}>
                                ${(payload?.provider_capabilities || []).map(item => html`<option value=${item.provider_id}>${item.provider_id}</option>`)}
                            </select></label>
                            <label>Quota dimension<select value=${draft.quota_dimension} onChange=${event => updateDraft({ quota_dimension: event.target.value })}>
                                ${(payload?.provider_capabilities || []).find(item => item.provider_id === draft.provider_id)?.dimensions?.map(value => html`<option value=${value}>${value}</option>`)}
                            </select></label>
                        `}
                    </div>
                    <p class="settings-hint">Metric: ${BUDGET_METRIC_LABELS[normalizeBudgetCapDraft(draft, payload || {}).metric]}. Provider credentials are bound server-side and never displayed.</p>
                    <div class="settings-budget-actions"><button type="button" onClick=${closeForm} disabled=${busy}>Cancel</button><button type="submit" disabled=${busy}>${busy ? 'Saving…' : draft.id ? 'Confirm update' : 'Create cap'}</button></div>
                </form>
            `}

            ${!loading && !showForm && html`
                <h3>Policy</h3>
                ${(payload?.caps || []).length === 0 ? html`<div class="settings-empty-state"><strong>No limits configured.</strong><p>Piclaw remains uncapped until you create a cap.</p></div>` : html`
                    <div class="settings-budget-cap-list">
                        ${(payload?.caps || []).map(cap => {
                            const evidence = budgetEvidenceState(cap);
                            return html`<article class=${`settings-budget-cap-card ${cap.enabled ? '' : 'disabled'}`}>
                                <div class="settings-budget-cap-header"><div><strong>${cap.id}</strong><span>${BUDGET_SCOPE_LABELS[cap.scope]} · ${BUDGET_METRIC_LABELS[cap.metric]}</span></div><${Pill} state=${cap.enabled ? 'active' : 'disabled'}>${cap.enabled ? 'Enabled' : 'Disabled'}<//></div>
                                <dl><div><dt>Limit</dt><dd>${formatBudgetAmount(cap.amount, cap.metric)}</dd></div><div><dt>Used/value</dt><dd>${cap.known_usage == null ? 'Unknown' : formatBudgetAmount(cap.known_usage, cap.metric)}</dd></div><div><dt>Remaining</dt><dd>${cap.remaining == null ? 'Unknown' : formatBudgetAmount(cap.remaining, cap.metric)}</dd></div><div><dt>Window/reset</dt><dd>${formatBudgetDate(cap.window?.ends_at)}</dd></div></dl>
                                <p class="settings-hint">${cap.timezone ? `${cap.timezone} · ` : ''}revision ${cap.revision}${cap.unknown_events ? ` · ${cap.unknown_events} unknown-priced event(s)` : ''}</p>
                                ${evidence && html`<${Pill} state=${evidence.state}>${evidence.label}<//>`}
                                <div class="settings-budget-actions"><button type="button" onClick=${() => editCap(cap)} disabled=${busy}>Edit</button><button type="button" onClick=${() => toggleCap(cap)} disabled=${busy}>${cap.enabled ? 'Disable' : 'Enable'}</button></div>
                            </article>`;
                        })}
                    </div>
                `}

                <h3>Current work</h3>
                ${!work ? html`<p class="settings-hint">No active or paused budget work is bound to this chat.</p>` : html`
                    <div class="settings-budget-work-card">
                        <div><strong>${work.id}</strong> <${Pill} state=${work.status}>${work.status}<//></div>
                        <p>${work.execution_kind} · last boundary ${work.last_boundary || '—'}</p>
                        ${payload?.override && html`<p><${Pill} state="warning">Warnings-only until ${formatBudgetDate(payload.override.expires_at)}<//></p>`}
                        ${(payload?.allowances || []).map(item => html`<p class="settings-hint">Allowance ${formatBudgetAmount(item.amount)} for ${item.cap_id} until ${formatBudgetDate(item.expires_at)}</p>`)}
                        ${work.status === 'paused' && html`
                            <form class="settings-budget-allowance" onSubmit=${async event => { event.preventDefault(); const next = await mutate({ action: 'grant_allowance', work_id: work.id, cap_id: allowance.cap_id, amount: allowance.amount, ...(allowance.expires_at ? { expires_at: new Date(allowance.expires_at).toISOString() } : {}) }, 'Allowance granted. Send a continuation message to resume.'); if (next) setAllowance({ cap_id: '', amount: '', expires_at: '' }); }}>
                                <label>Blocking cap<select required value=${allowance.cap_id} onChange=${event => setAllowance(current => ({ ...current, cap_id: event.target.value }))}><option value="">Select…</option>${pausedBlockers.map(item => html`<option value=${item.capId}>${item.capId}</option>`)}</select></label>
                                <label>Extra amount<input required inputmode="decimal" value=${allowance.amount} onInput=${event => setAllowance(current => ({ ...current, amount: event.target.value }))} /></label>
                                <label>Expiry (optional)<input type="datetime-local" value=${allowance.expires_at} onInput=${event => setAllowance(current => ({ ...current, expires_at: event.target.value }))} /></label>
                                <button type="submit" disabled=${busy}>Grant and resume</button>
                            </form>
                        `}
                        <div class="settings-budget-actions">
                            <button type="button" disabled=${busy} onClick=${() => window.confirm('Use warnings-only for one hour? Enforcement remains active for unrelated work.') && mutate({ action: 'warnings_only', work_id: work.id }, 'Warnings-only enabled. Send a continuation message to resume.')}>Warnings-only 1h</button>
                            ${work.status === 'paused' && html`<button type="button" disabled=${busy} onClick=${() => window.confirm('Resume this work without changing any cap? All caps will be rechecked.') && mutate({ action: 'resume_work', work_id: work.id }, 'Work is ready. Send a continuation message to resume.')}>Resume</button>`}
                            <button type="button" class="danger" disabled=${busy} onClick=${() => window.confirm(`Cancel ${work.id}? Charges remain in history.`) && mutate({ action: 'cancel_work', work_id: work.id }, `Cancelled ${work.id}.`)}>Cancel work</button>
                        </div>
                    </div>
                `}

                <h3>Scheduled runs</h3>
                <p class="settings-hint">Per-run <code>budget_usd</code> remains part of each scheduled task. Edit it there to keep one source of truth.</p>
                <button type="button" class="settings-secondary-btn" onClick=${() => requestBudgetSettingsSection(payload?.scheduled_task_settings_section || 'scheduled-tasks')}>Open Scheduled Tasks</button>
            `}
        </div>
    `;
}

export const __budgetSettingsTest = { resolveChatJid };
