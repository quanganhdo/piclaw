import { html, useEffect, useMemo, useState } from '../../vendor/preact-htm.js';
import {
    filterKeyboardShortcutActions,
    readKeyboardShortcutDrafts,
    resetKeyboardShortcutDraft,
    saveKeyboardShortcutDraft,
} from '../../ui/keyboard-shortcut-settings.js';
import { formatShortcutBindingList } from '../../ui/keyboard-shortcuts.js';
import { useTranslation } from '../../utils/i18n.js';

export function KeyboardSection({ filter = '', setStatus }) {
    const { t } = useTranslation();
    const [drafts, setDrafts] = useState(readKeyboardShortcutDrafts);

    useEffect(() => {
        const sync = () => setDrafts(readKeyboardShortcutDrafts());
        window.addEventListener('piclaw:keyboard-shortcuts-changed', sync);
        return () => window.removeEventListener('piclaw:keyboard-shortcuts-changed', sync);
    }, []);

    const visibleActions = useMemo(() => filterKeyboardShortcutActions(filter, drafts), [drafts, filter]);

    const saveAction = (actionId) => {
        const result = saveKeyboardShortcutDraft(actionId, drafts[actionId] || '');
        if (!result.ok) {
            setStatus?.(t('settings.keyboard.invalidShortcut', { token: result.invalidToken || '' }), 'error');
            return;
        }
        setDrafts(result.drafts);
        setStatus?.(t('settings.keyboard.saved'), 'success');
    };

    const resetAction = (actionId) => {
        setDrafts(resetKeyboardShortcutDraft(actionId));
        setStatus?.(t('settings.keyboard.resetOne'), 'success');
    };

    const resetAll = () => {
        setDrafts(resetKeyboardShortcutDraft());
        setStatus?.(t('settings.keyboard.resetAllDone'), 'success');
    };

    return html`
        <div class="settings-section">
            <h3>${t('settings.keyboard.heading')}</h3>
            <p class="settings-hint">
                ${t('settings.keyboard.hint1')}
                <code>Escape</code> ${t('settings.keyboard.hint1b')}
            </p>
            <p class="settings-hint">
                <code>/help</code> ${t('settings.keyboard.hint2mid')} <code>"</code> ${t('settings.keyboard.hint2end')}
            </p>

            <div class="settings-shortcut-toolbar">
                <button type="button" class="settings-addon-btn" onClick=${resetAll}>${t('settings.keyboard.resetAll')}</button>
            </div>

            <div class="settings-shortcut-list">
                ${visibleActions.map((action) => {
                    const inputId = `settings-shortcut-${action.id}`;
                    return html`
                    <div class="settings-shortcut-card" key=${action.id}>
                        <div class="settings-shortcut-copy">
                            <label class="settings-shortcut-title" for=${inputId}>${action.label}</label>
                            <div class="settings-hint settings-shortcut-description">${action.description}</div>
                            <div class="settings-shortcut-default">${t('settings.keyboard.defaultColon')} <code>${formatShortcutBindingList(action.defaultBindings)}</code></div>
                        </div>
                        <div class="settings-shortcut-controls">
                            <input
                                id=${inputId}
                                class="settings-shortcut-input"
                                type="text"
                                value=${drafts[action.id] || ''}
                                placeholder=${formatShortcutBindingList(action.defaultBindings)}
                                onInput=${(e) => setDrafts((prev) => ({ ...prev, [action.id]: e.target.value }))}
                            />
                            <div class="settings-shortcut-actions">
                                <button type="button" class="settings-addon-btn settings-addon-btn-install" onClick=${() => saveAction(action.id)}>${t('settings.keyboard.save')}</button>
                                <button type="button" class="settings-addon-btn" onClick=${() => resetAction(action.id)}>${t('settings.keyboard.defaultBtn')}</button>
                            </div>
                        </div>
                    </div>
                `})}
                ${visibleActions.length === 0 && html`<div class="settings-hint">${t('settings.keyboard.noMatch')}</div>`}
            </div>
        </div>
    `;
}
