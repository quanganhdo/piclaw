import { html, useCallback, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
    getWorkspaceIndexingSettings,
    previewWorkspaceIndexingPolicy,
    refreshWorkspaceIndexing,
    saveWorkspaceIndexingPolicy,
} from '../../api.js';

export function workspaceIndexPolicyFromText(rootsText, ignorePatternsText) {
    const lines = value => String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return { roots: lines(rootsText), ignorePatterns: lines(ignorePatternsText) };
}

function policyText(policy) {
    return {
        roots: Array.isArray(policy?.roots) ? policy.roots.join('\n') : '',
        ignorePatterns: Array.isArray(policy?.ignorePatterns) ? policy.ignorePatterns.join('\n') : '',
    };
}

export function WorkspaceIndexingSettings({ setStatus }) {
    const [rootsText, setRootsText] = useState('');
    const [ignorePatternsText, setIgnorePatternsText] = useState('');
    const [savedPolicy, setSavedPolicy] = useState(null);
    const [indexStatus, setIndexStatus] = useState(null);
    const [preview, setPreview] = useState(null);
    const [localError, setLocalError] = useState('');
    const [busyAction, setBusyAction] = useState('load');
    const mounted = useRef(true);

    const applyPolicy = useCallback((policy) => {
        const text = policyText(policy);
        setRootsText(text.roots);
        setIgnorePatternsText(text.ignorePatterns);
        setSavedPolicy(policy);
    }, []);

    useEffect(() => {
        mounted.current = true;
        getWorkspaceIndexingSettings().then(payload => {
            if (!mounted.current) return;
            applyPolicy(payload.policy);
            setIndexStatus(payload.status || null);
            setLocalError('');
        }).catch(error => {
            if (!mounted.current) return;
            const message = String(error?.message || error);
            setLocalError(message);
            setStatus?.(message, 'error');
        }).finally(() => {
            if (mounted.current) setBusyAction('');
        });
        return () => { mounted.current = false; };
    }, [applyPolicy, setStatus]);

    const draftPolicy = useMemo(
        () => workspaceIndexPolicyFromText(rootsText, ignorePatternsText),
        [rootsText, ignorePatternsText],
    );
    const dirty = savedPolicy !== null && JSON.stringify(draftPolicy) !== JSON.stringify(savedPolicy);

    const run = useCallback(async (action) => {
        setBusyAction(action);
        setLocalError('');
        try {
            if (action === 'preview') {
                const payload = await previewWorkspaceIndexingPolicy(draftPolicy);
                if (mounted.current) setPreview(payload.preview || null);
            } else if (action === 'save') {
                const payload = await saveWorkspaceIndexingPolicy(draftPolicy);
                if (mounted.current) {
                    applyPolicy(payload.policy);
                    setIndexStatus(payload.status || null);
                    setPreview(null);
                    setStatus?.('Workspace indexing policy saved. Refresh queued.');
                }
            } else {
                const payload = await refreshWorkspaceIndexing();
                if (mounted.current) {
                    setIndexStatus(payload.status || null);
                    setStatus?.('Workspace index refresh queued.');
                }
            }
        } catch (error) {
            if (!mounted.current) return;
            const message = String(error?.message || error);
            setLocalError(message);
            setStatus?.(message, 'error');
        } finally {
            if (mounted.current) setBusyAction('');
        }
    }, [applyPolicy, draftPolicy, setStatus]);

    const busy = Boolean(busyAction);
    return html`
        <section class="workspace-indexing-settings" aria-labelledby="workspace-indexing-heading" aria-busy=${busy ? 'true' : 'false'}>
            <h3 id="workspace-indexing-heading">Indexing</h3>
            <p class="settings-hint">Choose workspace-relative roots and exclusions for full-text search. Changes require an explicit save.</p>
            <div class="workspace-indexing-fields">
                <label>
                    <span>Indexed roots</span>
                    <textarea aria-label="Indexed roots" rows="5" value=${rootsText}
                        placeholder="notes\n.pi/skills" disabled=${busyAction === 'load'}
                        onInput=${event => setRootsText(event.target.value)}></textarea>
                    <small class="settings-hint">One workspace-relative path per line. An empty saved list indexes nothing.</small>
                </label>
                <label>
                    <span>Ignore patterns</span>
                    <textarea aria-label="Index ignore patterns" rows="5" value=${ignorePatternsText}
                        placeholder="# one pattern per line\n**/node_modules/**\n*.tmp" disabled=${busyAction === 'load'}
                        onInput=${event => setIgnorePatternsText(event.target.value)}></textarea>
                    <small class="settings-hint">Supports <code>*</code>, <code>**</code>, <code>?</code> and <code>#</code> comments. Negation and imported rule files are rejected.</small>
                </label>
            </div>
            <div class="workspace-indexing-actions">
                <button type="button" disabled=${busy} onClick=${() => run('preview')}>${busyAction === 'preview' ? 'Previewing…' : 'Preview'}</button>
                <button type="button" disabled=${busy || !dirty} onClick=${() => run('save')}>${busyAction === 'save' ? 'Saving…' : 'Save'}</button>
                <button type="button" disabled=${busy} onClick=${() => run('refresh')}>${busyAction === 'refresh' ? 'Queuing…' : 'Refresh now'}</button>
                ${dirty && html`<span class="settings-hint" role="status">Unsaved changes</span>`}
            </div>
            ${indexStatus && html`
                <div class="workspace-indexing-status" role="status" aria-live="polite">
                    <strong>Index ${String(indexStatus.state || 'unknown').replaceAll('_', ' ')}</strong>
                    <span>${Number(indexStatus.indexed_file_count || 0).toLocaleString()} indexed files</span>
                    ${indexStatus.last_indexed_at && html`<span>Last indexed ${indexStatus.last_indexed_at}</span>`}
                </div>
            `}
            ${(localError || indexStatus?.last_error) && html`
                <p class="workspace-indexing-error" role="alert">${localError || indexStatus.last_error}</p>
            `}
            ${preview && html`
                <div class="workspace-indexing-preview" aria-live="polite">
                    <strong>Preview: ${preview.includedFiles} files included, ${preview.excludedEntries} entries excluded</strong>
                    <span>${preview.scannedEntries} entries checked in ${preview.elapsedMs} ms${preview.truncated ? ' (bounded preview stopped at its limit)' : ''}.</span>
                    ${Array.isArray(preview.samples) && preview.samples.length > 0 && html`
                        <details>
                            <summary>Sample decisions and reasons</summary>
                            <ul>
                                ${preview.samples.slice(0, 30).map(sample => html`
                                    <li><code>${sample.path}</code> — ${sample.included ? 'included' : 'excluded'}: ${sample.reason}${sample.rule ? ` (${sample.rule})` : ''}</li>
                                `)}
                            </ul>
                        </details>
                    `}
                </div>
            `}
        </section>
    `;
}
