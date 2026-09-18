/**
 * vnc-pane.ts — WebPaneExtension scaffold for a VNC viewer/proxy tab.
 *
 * This slice keeps the real pane host plus backend session/proxy plumbing,
 * and now adds the first real RFB/VNC render path: handshake parsing plus
 * raw-framebuffer rendering onto a canvas.
 */

import type { PaneCapability, PaneContext, PaneInstance, WebPaneExtension } from './pane-types.js';
import { WebSocketRemoteDisplayBoundary } from './remote-display-socket.js';
import { readRandomUuidBestEffort, removeStorageItemBestEffort } from './pane-runtime-safety.js';
import { loadRemoteDisplayWasmDecoder } from './remote-display-decoder.js';
import {
    boundedVncClientClipboardText,
    buildVncWheelPointerEvents,
    computeContainedRemoteDisplayScale,
    encodeVncClientCutText,
    encodeVncKeyEvent,
    encodeVncPointerEvent,
    hasVncTouchTapSlopBeenExceeded,
    isVncDeferredTouchPointerType,
    mapClientToFramebufferPoint,
    normalizeVncPassword,
    resolveVncKeysymFromKeyboardEvent,
    resolveVncPointerPressMask,
    shouldArmVncImplicitReleaseTimer,
    shouldReleaseVncPointerContact,
    shouldReleaseVncTouchContact,
    shouldSkipDuplicateVncKeydown,
    shouldTriggerVncTouchTap,
    vncButtonMaskForPointerButton,
} from './vnc-input.js';
import { VncRemoteDisplayProtocol } from './remote-display-vnc.js';
import { installVncViewerStyles, vncSessionMarkup } from './vnc-viewer-ui.js';
import { readVncHistory, recordVncSuccess, writeVncHistory, scopedVncHistoryStorage } from './vnc-history.js';

export const VNC_TAB_PREFIX = 'piclaw://vnc';
export const CDP_BROWSER_VNC_TARGET_ID = 'cdp-browser';
export const CDP_BROWSER_VNC_TAB_PATH = `${VNC_TAB_PREFIX}/${CDP_BROWSER_VNC_TARGET_ID}`;
export const DEFAULT_DIRECT_VNC_TARGET = Object.freeze({ host: 'localhost', port: '5901' });
export const VNC_DIRECT_TARGET_STORAGE_KEY = 'piclaw:vnc-direct-target';
export const MAX_VNC_FRAMEBUFFER_DIMENSION = 8192;
export const MAX_VNC_FRAMEBUFFER_PIXELS = 16 * 1024 * 1024;
export const MAX_VNC_CURSOR_DIMENSION = 256;
export const MAX_VNC_CURSOR_PIXELS = 256 * 256;

export function isVncFramebufferSizeAllowed(width, height): boolean {
    const w = Math.max(1, Math.floor(Number(width || 0)));
    const h = Math.max(1, Math.floor(Number(height || 0)));
    return w <= MAX_VNC_FRAMEBUFFER_DIMENSION
        && h <= MAX_VNC_FRAMEBUFFER_DIMENSION
        && w * h <= MAX_VNC_FRAMEBUFFER_PIXELS;
}

export function isVncCursorRectAllowed(rect): boolean {
    const width = Math.floor(Number(rect?.width || 0));
    const height = Math.floor(Number(rect?.height || 0));
    return Boolean(rect?.rgba)
        && width > 0
        && height > 0
        && width <= MAX_VNC_CURSOR_DIMENSION
        && height <= MAX_VNC_CURSOR_DIMENSION
        && width * height <= MAX_VNC_CURSOR_PIXELS;
}

export function buildVncTabPath(targetId?: string | null): string {
    const target = String(targetId || '').trim();
    return target ? `${VNC_TAB_PREFIX}/${encodeURIComponent(target)}` : VNC_TAB_PREFIX;
}

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    key?(index: number): string | null;
    length?: number;
}

const VNC_POPOUT_SECRET_PREFIX = 'piclaw:vnc-popout:';
const VNC_POPOUT_SECRET_TTL_MS = 60_000;
let vncPagePassword: string | null = null;

function getVncLocalStorage(runtime = globalThis): StorageLike | null {
    try {
        return runtime?.localStorage ?? null;
    } catch {
        return null;
    }
}

export function getVncPagePassword(): string | null {
    return vncPagePassword;
}

export function clearVncPagePassword(): void {
    vncPagePassword = null;
}

export function rememberVncPagePassword(password?: string | null): string | null {
    vncPagePassword = normalizeVncPassword(password);
    return vncPagePassword;
}

function generateVncPopoutSecretToken(runtime = globalThis): string {
    const uuid = readRandomUuidBestEffort(runtime);
    if (uuid) {
        return uuid;
    }
    return `vnc-popout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sweepExpiredVncPopoutSecrets(storage: StorageLike | null, nowMs = Date.now()): void {
    if (!storage || typeof storage.key !== 'function' || !Number.isFinite(storage.length)) return;
    const keys: string[] = [];
    for (let i = 0; i < Number(storage.length || 0); i += 1) {
        const key = storage.key(i);
        if (key && key.startsWith(VNC_POPOUT_SECRET_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
        try {
            const raw = storage.getItem(key);
            if (!raw) {
                storage.removeItem(key);
                continue;
            }
            const parsed = JSON.parse(raw);
            const expiresAt = Number(parsed?.expiresAt || 0);
            if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
                storage.removeItem(key);
            }
        } catch {
            removeStorageItemBestEffort(storage, key);
        }
    }
}

export function stashVncPopoutPassword(password?: string | null, runtime = globalThis, nowMs = Date.now()): string | null {
    const normalized = normalizeVncPassword(password);
    if (normalized === null) return null;
    const storage = getVncLocalStorage(runtime);
    if (!storage) return null;
    sweepExpiredVncPopoutSecrets(storage, nowMs);
    const token = generateVncPopoutSecretToken(runtime);
    try {
        storage.setItem(`${VNC_POPOUT_SECRET_PREFIX}${token}`, JSON.stringify({
            password: normalized,
            expiresAt: nowMs + VNC_POPOUT_SECRET_TTL_MS,
        }));
        return token;
    } catch {
        return null;
    }
}

export function consumeVncPopoutPassword(token?: string | null, runtime = globalThis, nowMs = Date.now()): string | null {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) return null;
    const storage = getVncLocalStorage(runtime);
    if (!storage) return null;
    sweepExpiredVncPopoutSecrets(storage, nowMs);
    const key = `${VNC_POPOUT_SECRET_PREFIX}${normalizedToken}`;
    try {
        const raw = storage.getItem(key);
        storage.removeItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const expiresAt = Number(parsed?.expiresAt || 0);
        if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;
        return normalizeVncPassword(parsed?.password);
    } catch {
        try { storage.removeItem(key); } catch { /* ignore */ }
        return null;
    }
}

export function createVncPopoutTransferPayload(targetId?: string | null, password?: string | null, runtime = globalThis): Record<string, string> | null {
    const target = String(targetId || '').trim();
    if (!target) return null;
    const payload: Record<string, string> = {
        pane_path: buildVncTabPath(target),
    };
    const passwordToken = stashVncPopoutPassword(password, runtime);
    if (passwordToken) {
        payload.vnc_secret = passwordToken;
    }
    return payload;
}

export function parseVncTargetFromPath(path?: string): string | null {
    const raw = String(path || '');
    if (raw === VNC_TAB_PREFIX) return null;
    if (!raw.startsWith(`${VNC_TAB_PREFIX}/`)) return null;
    const suffix = raw.slice(`${VNC_TAB_PREFIX}/`.length).trim();
    if (!suffix) return null;
    try {
        return decodeURIComponent(suffix);
    } catch {
        return suffix;
    }
}

export function shouldOpenVncTargetDirectly(path?: string): boolean {
    return parseVncTargetFromPath(path) !== null;
}

function esc(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function fetchVncSession(targetId = null) {
    const url = targetId ? `/vnc/session?target=${encodeURIComponent(targetId)}` : '/vnc/session';
    const response = await fetch(url, { credentials: 'same-origin' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
    return body;
}

function buildVncWebSocketUrl(targetId, handoffToken = null) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(`${protocol}//${window.location.host}/vnc/ws`);
    url.searchParams.set('target', String(targetId || ''));
    if (handoffToken) {
        url.searchParams.set('handoff', String(handoffToken));
    }
    return url.toString();
}

export function normalizeDirectVncHost(host) {
    const rawHost = String(host || '').trim();
    return rawHost || DEFAULT_DIRECT_VNC_TARGET.host;
}

function normalizeDirectVncTarget(host, port): { host: string; port: string } | null {
    const normalizedHost = normalizeDirectVncHost(host);
    const normalizedPort = Number(String(port ?? '').trim());
    if (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) return null;
    return { host: normalizedHost, port: String(normalizedPort) };
}

export function buildDirectVncTargetReference(host, port) {
    const target = normalizeDirectVncTarget(host, port);
    if (!target) return null;
    const normalizedHost = target.host.includes(':') && !target.host.startsWith('[') ? `[${target.host}]` : target.host;
    return `${normalizedHost}:${target.port}`;
}

export function loadVncDirectTarget(runtime = globalThis): { host: string; port: string } {
    const fallback = { ...DEFAULT_DIRECT_VNC_TARGET };
    const storage = getVncLocalStorage(runtime);
    if (!storage) return fallback;
    try {
        const raw = storage.getItem(VNC_DIRECT_TARGET_STORAGE_KEY);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return normalizeDirectVncTarget(parsed?.host, parsed?.port) ?? fallback;
    } catch {
        return fallback;
    }
}

export function persistVncDirectTarget(host, port, runtime = globalThis): boolean {
    const target = normalizeDirectVncTarget(host, port);
    if (!target) return false;
    const storage = getVncLocalStorage(runtime);
    if (!storage) return false;
    try {
        storage.setItem(VNC_DIRECT_TARGET_STORAGE_KEY, JSON.stringify(target));
        return true;
    } catch {
        return false;
    }
}

/** A validated form submission counts as selected before the asynchronous socket attempt starts. */
export function prepareDirectVncSelection(host, port, password?: string | null, runtime = globalThis): { targetRef: string; password: string | null } | null {
    const target = normalizeDirectVncTarget(host, port);
    if (!target) return null;
    const targetRef = buildDirectVncTargetReference(target.host, target.port);
    if (!targetRef) return null;
    persistVncDirectTarget(target.host, target.port, runtime);
    return {
        targetRef,
        password: rememberVncPagePassword(password),
    };
}

export function getVncTargetsEmptyStateCopy(options: Record<string, any> = {}) {
    const enabled = Boolean(options?.enabled);
    const directConnectEnabled = Boolean(options?.directConnectEnabled);
    const targetCount = Array.isArray(options?.targets) ? options.targets.length : Number(options?.targetCount || 0);

    if (targetCount > 0) {
        return {
            title: '',
            body: '',
        };
    }

    if (directConnectEnabled) {
        return {
            title: 'No saved VNC targets yet.',
            body: 'Connect directly above.',
        };
    }

    if (!enabled) {
        return {
            title: 'VNC is not configured yet.',
            body: 'No saved targets are available and direct connect is disabled on this host.',
        };
    }

    return {
        title: 'No saved VNC targets yet.',
        body: 'This host has no configured VNC targets, and direct connect is disabled.',
    };
}

function consumePanePopoutTransferToken(paramName) {
    if (typeof window === 'undefined') return null;
    try {
        const url = new URL(window.location.href);
        const token = url.searchParams.get(paramName)?.trim() || '';
        if (!token) return null;
        url.searchParams.delete(paramName);
        window.history?.replaceState?.(window.history.state, document.title, url.toString());
        return token;
    } catch {
        return null;
    }
}

export function shouldRetryVncPopoutWithoutHandoff(options) {
    const handoffToken = String(options?.handoffToken || '').trim();
    if (!handoffToken) return false;
    return Number(options?.bytesIn || 0) <= 0
        && !options?.hasRenderedFrame
        && Number(options?.reconnectAttempts || 0) <= 0;
}

export function relocateVncPaneRoot(root, container) {
    if (!root || !container || typeof container.appendChild !== 'function') return false;
    try {
        container.innerHTML = '';
    } catch {
        /* expected: fake hosts/tests may not implement innerHTML writes. */
    }
    container.appendChild(root);
    return true;
}

class VncPaneInstance implements PaneInstance {
    private container;
    private root;
    private statusEl;
    private bodyEl;
    private metricsEl;
    private targetSubtitleEl;
    private socketBoundary = null;
    private protocol = null;
    private disposed = false;
    private targetId = null;
    private targetLabel = null;
    private bytesIn = 0;
    private bytesOut = 0;
    private canvas = null;
    private canvasCtx = null;
    private displayPlaceholderEl = null;
    private displayInfoEl = null;
    private displayMetaEl = null;
    private displayStageEl = null;
    private chromeEl = null;
    private sessionShellEl = null;
    private resizeObserver = null;
    private displayScale = null;
    private readOnly = false;
    private pointerButtonMask = 0;
    private pointerInputAbortController = null;
    private pressedKeysyms = new Map();
    private passwordInputEl = null;
    private clipboardInputEl = null;
    private authPassword = getVncPagePassword();
    private directHostInputEl = null;
    private directPortInputEl = null;
    private directPasswordInputEl = null;
    private hasRenderedFrame = false;
    private frameTimeoutId = null;
    private reconnectTimerId = null;
    private reconnectAttempts = 0;
    private rawFallbackAttempted = false;
    private protocolRecovering = false;
    private pendingHandoffToken = null;
    private uiAbort: AbortController | null = null;
    private uiTimers = new Set<ReturnType<typeof setTimeout>>();
    private releasePointers: (() => void) | null = null;
    private connectionGeneration = 0;
    private connected = false;
    private manuallyStopped = false;
    private recordedSuccess = false;
    private menuPinned = false;
    private remoteClipboard = '';
    private chooserOverlay: HTMLElement | null = null;
    private historyStorage: ReturnType<typeof scopedVncHistoryStorage> = null;
    private cueEl: HTMLButtonElement | null = null;

    constructor(container, context) {
        this.container = container;
        this.targetId = parseVncTargetFromPath(context?.path);
        installVncViewerStyles(container.ownerDocument || document);
        this.targetLabel = this.targetId || null;
        this.pendingHandoffToken = consumePanePopoutTransferToken('vnc_handoff');
        const passwordToken = consumePanePopoutTransferToken('vnc_secret');
        const transferredPassword = consumeVncPopoutPassword(passwordToken);
        if (transferredPassword !== null) {
            this.authPassword = rememberVncPagePassword(transferredPassword);
        }

        this.root = document.createElement('div');
        this.root.className = 'vnc-pane-shell';
        this.root.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;background:var(--bg-primary);color:var(--text-primary);';

        this.targetSubtitleEl = null;

        this.statusEl = document.createElement('div');
        this.statusEl.style.cssText = 'display:none;';
        this.statusEl.textContent = '';

        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'vnc-pane-body';

        this.metricsEl = document.createElement('div');
        this.metricsEl.style.cssText = 'display:none;';
        this.updateMetrics();

        this.root.append(this.statusEl, this.bodyEl);
        this.container.appendChild(this.root);

        void this.load();
    }

    private setStatus(message) {
        this.statusEl.textContent = String(message || '');
    }

    private setSessionChromeVisible(visible) {
        this.clearUiTimers();
        if (visible) { this.releasePressedKeys(); this.releasePointers?.(); }
        if (this.chromeEl) this.chromeEl.hidden = !visible;
        if (this.cueEl) { this.cueEl.classList.toggle('vnc-cue-hidden', !visible); this.cueEl.setAttribute('aria-expanded', String(visible)); }
        if (!visible) this.menuPinned = false;
    }

    private clearUiTimers() {
        for (const timer of this.uiTimers) clearTimeout(timer);
        this.uiTimers.clear();
    }

    private laterUi(callback: () => void, delay: number) {
        const timer = setTimeout(() => { this.uiTimers.delete(timer); if (!this.disposed) callback(); }, delay);
        this.uiTimers.add(timer);
    }

    private canSendInput(): boolean {
        return this.connected && !this.readOnly && !this.manuallyStopped && !this.chooserOverlay
            && Boolean(this.chromeEl?.hidden);
    }

    private setConnectionState(state: string, message: string) {
        this.root.dataset.vncState = state;
        const stateEl = this.bodyEl.querySelector('[data-vnc-state]');
        if (stateEl) stateEl.textContent = message;
        const progress = this.bodyEl.querySelector('[data-vnc-progress]');
        if (progress) progress.textContent = message;
        if (this.displayPlaceholderEl) this.displayPlaceholderEl.hidden = state === 'connected';
    }

    private stopConnection() {
        this.manuallyStopped = true;
        this.releasePressedKeys(); this.releasePointers?.();
        this.connected = false;
        this.connectionGeneration += 1;
        this.clearReconnectTimer();
        if (this.frameTimeoutId) clearTimeout(this.frameTimeoutId);
        this.frameTimeoutId = null;
        this.socketBoundary?.dispose(); this.socketBoundary = null;
        this.clearUiTimers();
    }

    private clearReconnectTimer() {
        if (this.reconnectTimerId) {
            clearTimeout(this.reconnectTimerId);
            this.reconnectTimerId = null;
        }
    }

    private scheduleReconnect(delayOverrideMs = null) {
        if (this.disposed || !this.targetId || this.manuallyStopped || this.reconnectAttempts >= 3) return;
        this.clearReconnectTimer();
        const computedDelayMs = Math.min(8000, 1500 + (this.reconnectAttempts * 1000));
        const delayMs = Number.isFinite(delayOverrideMs) ? Math.max(0, Number(delayOverrideMs)) : computedDelayMs;
        this.reconnectAttempts += 1;
        this.reconnectTimerId = setTimeout(() => {
            this.reconnectTimerId = null;
            if (this.disposed || !this.targetId) return;
            void this.connectSocket();
        }, delayMs);
    }

    private updateMetrics() {
        this.metricsEl.textContent = `Transport bytes — in: ${this.bytesIn} / out: ${this.bytesOut}`;
    }

    private applyMetrics(metrics) {
        this.bytesIn = Number(metrics?.bytesIn || 0);
        this.bytesOut = Number(metrics?.bytesOut || 0);
        this.updateMetrics();
    }

    private resetLiveSession() {
        this.connectionGeneration += 1;
        this.uiAbort?.abort(); this.uiAbort = null;
        this.clearUiTimers();
        this.releasePressedKeys(); this.releasePointers?.(); this.releasePointers = null;
        this.connected = false; this.recordedSuccess = false;
        this.remoteClipboard = '';
        this.chooserOverlay?.remove(); this.chooserOverlay = null;
        this.cueEl = null; this.chromeEl = null;
        this.clearReconnectTimer();
        this.reconnectAttempts = 0;
        this.protocol = null;
        try { this.socketBoundary?.dispose?.(); } catch { /* expected: socket boundary may already be torn down during session resets. */ }
        this.socketBoundary = null;
        try { this.resizeObserver?.disconnect?.(); } catch { /* expected: resize observer may already be disconnected during session resets. */ }
        this.resizeObserver = null;
        try { this.pointerInputAbortController?.abort?.(); } catch { /* expected: pointer listener teardown may already be complete during session resets. */ }
        this.pointerInputAbortController = null;
        this.canvas = null;
        this.canvasCtx = null;
        this.displayPlaceholderEl = null;
        this.displayInfoEl = null;
        this.displayMetaEl = null;
        this.displayStageEl = null;
        this.displayScale = null;
        this.passwordInputEl = null;
        this.clipboardInputEl = null;
        this.directHostInputEl = null;
        this.directPortInputEl = null;
        this.directPasswordInputEl = null;
        this.hasRenderedFrame = false;
        this.rawFallbackAttempted = false;
        this.protocolRecovering = false;
        if (this.frameTimeoutId) {
            clearTimeout(this.frameTimeoutId);
            this.frameTimeoutId = null;
        }
        this.pressedKeysyms.clear();
    }

    private renderTargets(payload, overlay = false) {
        if (!overlay) this.resetLiveSession();
        const targets = Array.isArray(payload?.targets) ? payload.targets : [];
        const allowDirect = Boolean(payload?.direct_connect_enabled);
        const direct = DEFAULT_DIRECT_VNC_TARGET;
        const host = document.createElement('div');
        host.className = 'vnc-manager';
        if (overlay) {
            this.releasePressedKeys(); this.releasePointers?.();
            host.style.cssText = 'position:absolute;inset:0;z-index:5;background:var(--bg-primary);';
            this.chooserOverlay = host;
        }
        const entries = readVncHistory(this.historyStorage);
        host.innerHTML = `<section><h2>Connections</h2>
            <input type="search" data-vnc-search aria-label="Filter connections" placeholder="Find a name or address…">
            <h3>Configured targets</h3><div data-vnc-configured></div>
            <h3>Recent connections</h3><div data-vnc-history></div>
            <button data-vnc-clear>Clear recent history</button>
            <p>History stays in this browser for this account and instance. No passwords or clipboard text are saved.</p>
            ${overlay ? '<button data-vnc-back>Return to desktop</button>' : ''}</section>
            <section>${allowDirect ? `<h2>New connection</h2><form data-vnc-connect-form>
            <div class="vnc-endpoint"><label><span>Server</span><input data-vnc-direct-host value="${esc(direct.host)}" autocomplete="off" spellcheck="false"></label>
            <label><span>Port</span><input type="number" required min="1" max="65535" step="1" data-vnc-direct-port value="${esc(direct.port)}"></label></div>
            <details><summary>Password, if required</summary><label><span>VNC password</span><input type="password" data-vnc-direct-password autocomplete="off"></label></details>
            <p data-vnc-form-error role="alert"></p><button class="vnc-connect" type="submit">Connect</button></form>
            <p>Addresses are reached from the Piclaw server. The default is localhost:5901.</p>` : '<p>Direct connections are disabled. Choose a configured target.</p>'}
            <p>During a session, move to the top centre for the reveal chevron. Hover or tap it for controls. Keyboard: Ctrl+Alt+Shift+V.</p></section>`;
        const select = (target: string, label: string, password: string | null = null) => {
            if (overlay && target === this.targetId && this.connected) { host.remove(); this.chooserOverlay = null; this.setSessionChromeVisible(false); this.focus(); return; }
            this.authPassword = password;
            this.targetId = target; this.targetLabel = label;
            this.manuallyStopped = false;
            void this.load();
        };
        const draw = () => {
            const query = String((host.querySelector('[data-vnc-search]') as HTMLInputElement).value || '').toLowerCase();
            const matches = (label, id) => (String(label) + ' ' + id).toLowerCase().includes(query);
            const configured = host.querySelector('[data-vnc-configured]');
            configured.replaceChildren();
            for (const target of targets.filter(t => matches(t.label, t.id))) {
                const row = document.createElement('div'); row.className = 'vnc-history-row';
                row.innerHTML = `<button class="vnc-history-open"><strong>${esc(target.label || target.id)}</strong><small>${esc(target.id)} · ${target.readOnly ? 'Read-only' : 'Interactive'}</small></button>`;
                row.querySelector('button').onclick = () => select(target.id, target.label || target.id);
                configured.append(row);
            }
            if (!configured.children.length) configured.textContent = query ? 'No matching configured targets.' : 'No configured targets.';
            const list = host.querySelector('[data-vnc-history]'); list.replaceChildren();
            for (const entry of entries.filter(e => matches(e.label, e.target)).sort((a,b) => Number(b.pinned)-Number(a.pinned) || b.connectedAt-a.connectedAt)) {
                const available = allowDirect || targets.some(t => t.id === entry.target);
                const row = document.createElement('div'); row.className = 'vnc-history-row';
                row.innerHTML = `<button class="vnc-history-open" ${available ? '' : 'disabled'}><strong>${esc(entry.label)}</strong><small>${esc(entry.target)} · ${available ? esc(new Date(entry.connectedAt).toLocaleString()) : 'Unavailable under current policy'}</small></button>
                    <button data-pin aria-label="${entry.pinned ? 'Unpin' : 'Pin'} ${esc(entry.label)}">${entry.pinned ? '★' : '☆'}</button><button data-remove aria-label="Remove ${esc(entry.label)}">×</button>`;
                row.querySelector('.vnc-history-open').addEventListener('click', () => select(entry.target, entry.label));
                row.querySelector('[data-pin]').addEventListener('click', () => { entry.pinned = !entry.pinned; writeVncHistory(this.historyStorage, entries); draw(); });
                row.querySelector('[data-remove]').addEventListener('click', () => { entries.splice(entries.indexOf(entry),1); writeVncHistory(this.historyStorage, entries); draw(); });
                list.append(row);
            }
            if (!list.children.length) list.textContent = query ? 'No matching recent connections.' : 'Successful connections will appear here.';
        };
        host.querySelector('[data-vnc-search]').addEventListener('input', draw);
        host.querySelector('[data-vnc-clear]').addEventListener('click', () => { for (let i=entries.length-1;i>=0;i--) if(!entries[i].pinned) entries.splice(i,1); writeVncHistory(this.historyStorage,entries); draw(); });
        const close = () => { host.remove(); this.chooserOverlay = null; this.setSessionChromeVisible(false); this.focus(); };
        host.querySelector('[data-vnc-back]')?.addEventListener('click', close);
        host.addEventListener('keydown', event => { event.stopPropagation(); if (overlay && event.key === 'Escape') { event.preventDefault(); close(); } });
        host.querySelector('[data-vnc-connect-form]')?.addEventListener('submit', event => {
            event.preventDefault();
            const { host: hostValue, port: portValue } = normalizeDirectVncTarget((host.querySelector('[data-vnc-direct-host]') as HTMLInputElement).value,
                (host.querySelector('[data-vnc-direct-port]') as HTMLInputElement).value) || {host: '', port: ''};
            const selection = hostValue && portValue && !/[\s/@?#]/.test(hostValue) ? {
                targetRef: buildDirectVncTargetReference(hostValue, portValue),
                password: normalizeVncPassword((host.querySelector('[data-vnc-direct-password]') as HTMLInputElement).value),
            } : null;
            if (!selection) { host.querySelector('[data-vnc-form-error]').textContent = 'Use a valid host and a port from 1 to 65535.'; return; }
            select(selection.targetRef, selection.targetRef, selection.password);
        });
        if (!overlay) this.bodyEl.replaceChildren(host); else this.bodyEl.append(host);
        draw(); host.querySelector('input')?.focus();
    }

    private renderTargetSession(payload) {
        this.resetLiveSession();
        const target = payload?.target || {};
        this.targetLabel = target.label || this.targetId || 'VNC';
        this.readOnly = Boolean(target.read_only);
        this.bodyEl.innerHTML = vncSessionMarkup(this.targetLabel, this.readOnly);
        this.sessionShellEl = this.bodyEl.querySelector('[data-vnc-session-shell]');
        this.chromeEl = this.bodyEl.querySelector('[data-vnc-session-chrome]');
        this.cueEl = this.bodyEl.querySelector('[data-vnc-cue]');
        this.displayStageEl = this.bodyEl.querySelector('[data-display-stage]');
        this.canvas = this.bodyEl.querySelector('[data-display-canvas]');
        this.displayPlaceholderEl = this.bodyEl.querySelector('[data-display-placeholder]');
        this.displayInfoEl = this.bodyEl.querySelector('[data-display-info]');
        this.displayMetaEl = this.bodyEl.querySelector('[data-display-meta]');
        this.canvasCtx = this.canvas.getContext('2d', { alpha: false });
        this.passwordInputEl = this.bodyEl.querySelector('[data-vnc-password]');
        this.passwordInputEl.value = this.authPassword || '';
        this.clipboardInputEl = this.bodyEl.querySelector('[data-vnc-clipboard]');
        this.setSessionChromeVisible(false);
        this.attachDisplayResizeObserver();
        this.attachCanvasPointerHandlers(); this.attachCanvasKeyboardHandlers();
        this.installVncClipboardControls(); this.installViewerControls();
        this.setConnectionState('connecting', 'Connecting…');
        this.setSessionChromeVisible(true);
    }

    private installViewerControls() {
        this.uiAbort = new AbortController();
        const signal = this.uiAbort.signal;
        const show = (pinned = false) => { this.menuPinned = pinned; this.setSessionChromeVisible(true); if(pinned) this.chromeEl.querySelector('button')?.focus(); };
        const hide = () => { this.setSessionChromeVisible(false); this.focus(); };
        const nearEdge = event => { const rect=this.displayStageEl.getBoundingClientRect(); return Math.abs(event.clientX-rect.x-rect.width/2)<70 && event.clientY>=rect.y && event.clientY-rect.y<24; };
        const deferHide = () => { this.clearUiTimers(); this.laterUi(() => {
            if(!this.connected || this.menuPinned || this.chromeEl?.matches(':hover') || this.chromeEl?.querySelector('details[open]') || this.chromeEl?.contains(document.activeElement)) return;
            this.setSessionChromeVisible(false);
        },350); };
        this.sessionShellEl.addEventListener('pointermove', event => {
            if(!this.connected || this.chooserOverlay || event.pointerType==='touch' || !this.chromeEl.hidden) return;
            this.cueEl.classList.toggle('vnc-cue-hidden', !nearEdge(event));
        }, {signal});
        this.cueEl.addEventListener('pointerenter', event => { if(event.pointerType==='touch') return; this.clearUiTimers(); this.laterUi(()=>show(),200); }, {signal});
        this.cueEl.addEventListener('click',()=>show(true),{signal});
        this.cueEl.addEventListener('pointerleave',deferHide,{signal});
        this.chromeEl.addEventListener('pointerenter',()=>this.clearUiTimers(),{signal});
        this.chromeEl.addEventListener('pointerleave',deferHide,{signal});
        this.chromeEl.addEventListener('focusin',()=>{this.menuPinned=true;this.clearUiTimers();},{signal});
        this.chromeEl.addEventListener('toggle',deferHide,{signal,capture:true});
        this.chromeEl.querySelector('[data-vnc-hide]').addEventListener('click',hide,{signal});
        const reconnect = () => { this.authPassword = normalizeVncPassword(this.passwordInputEl.value); this.manuallyStopped=false; this.reconnectAttempts=0; void this.connectSocket(); };
        this.chromeEl.querySelector('[data-vnc-reconnect]').addEventListener('click', reconnect,{signal});
        this.chromeEl.querySelector('[data-vnc-auth-connect]').addEventListener('click', reconnect,{signal});
        this.passwordInputEl.addEventListener('keydown', event => { if(event.key==='Enter'){event.preventDefault();reconnect();} },{signal});
        this.chromeEl.querySelector('[data-vnc-disconnect]').addEventListener('click',()=>{
            this.stopConnection(); this.authPassword=null; clearVncPagePassword(); this.passwordInputEl.value='';
            this.setConnectionState('disconnected','Disconnected. Choose Reconnect or Connections.'); show(true);
        },{signal});
        this.chromeEl.querySelector('[data-open-target-picker]').addEventListener('click',async()=>{
            const generation=this.connectionGeneration;
            try {const payload=await fetchVncSession(); if(this.disposed||generation!==this.connectionGeneration)return; this.historyStorage=scopedVncHistoryStorage(getVncLocalStorage(),payload?.history_scope); this.renderTargets(payload,true);}
            catch(error){this.updateDisplayInfo(String(error?.message||error));}
        },{signal});
        this.root.addEventListener('keydown',event=>{
            if(event.ctrlKey&&event.altKey&&event.shiftKey&&event.code==='KeyV'){event.preventDefault();event.stopImmediatePropagation();show(true);return;}
            if(!this.chromeEl.hidden && this.chromeEl.contains(event.target) && event.key==='Escape') { event.preventDefault(); event.stopPropagation(); hide(); }
        },{signal,capture:true});
        this.chromeEl.addEventListener('keydown', event => event.stopPropagation(), {signal});
        this.chromeEl.addEventListener('keyup', event => event.stopPropagation(), {signal});
        this.chromeEl.addEventListener('focusout', () => { this.menuPinned=false; deferHide(); }, {signal});
        this.sessionShellEl.addEventListener('pointerleave', deferHide, {signal});
        this.canvas.addEventListener('pointerdown', event => {
            if (!this.chromeEl.hidden) { event.preventDefault(); event.stopImmediatePropagation(); hide(); }
        }, {signal,capture:true});
        let touchId: number | null=null;
        let startY=0;
        this.sessionShellEl.addEventListener('pointerdown',event=>{
            if(this.chromeEl.hidden && event.pointerType==='touch'&&nearEdge(event)){event.preventDefault();event.stopImmediatePropagation();touchId=event.pointerId;startY=event.clientY;this.releasePressedKeys();this.releasePointers?.();this.cueEl.classList.remove('vnc-cue-hidden');}
        },{signal,capture:true});
        for(const type of ['pointermove','pointerup','pointercancel']) this.sessionShellEl.addEventListener(type,event=>{
            if(event.pointerId!==touchId)return;event.preventDefault();event.stopImmediatePropagation();
            if(type!=='pointermove'){touchId=null;if(type==='pointerup'&&(event.clientY-startY>35 || Math.abs(event.clientY-startY)<10))show(true);}
        },{signal,capture:true});
    }

    private clipboardStatus(message: string) {
        const status = this.bodyEl.querySelector('[data-vnc-clipboard-status]');
        if (status) status.textContent = message;
    }

    private installVncClipboardControls() {
        const field = this.clipboardInputEl;
        const isCurrent = () => !this.disposed && this.clipboardInputEl === field;
        this.bodyEl.querySelector('[data-vnc-send-clipboard]')?.addEventListener('click', () => this.sendClientClipboardText(this.clipboardInputEl?.value || ''));
        this.bodyEl.querySelector('[data-vnc-copy-clipboard]')?.addEventListener('click', async () => {
            const field = this.clipboardInputEl;
            try {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
                await navigator.clipboard.writeText(this.remoteClipboard);
                if (isCurrent()) this.clipboardStatus('Remote text copied locally.');
            } catch {
                if (!isCurrent()) return;
                field.value = this.remoteClipboard; field.focus(); field.select();
                this.clipboardStatus('Press Ctrl+C or use Copy to copy the selected remote text.');
            }
        });
        this.bodyEl.querySelector('[data-vnc-paste-clipboard]')?.addEventListener('click', async () => {
            try {
                if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable');
                const text = await navigator.clipboard.readText();
                if (!isCurrent()) return;
                this.clipboardInputEl.value = boundedVncClientClipboardText(text);
                this.clipboardStatus('Local text pasted. Choose Send to remote to transfer it.');
            } catch {
                if (!isCurrent()) return;
                this.clipboardInputEl.focus();
                this.clipboardStatus('Press Ctrl+V or use Paste in the clipboard field.');
            }
        });
    }

    private sendClientClipboardText(text) {
        if (this.readOnly) return;
        if (!this.connected || this.manuallyStopped || !this.socketBoundary || !this.protocol || this.protocol.state !== 'connected') {
            this.clipboardStatus('Clipboard can be sent after VNC connects.');
            this.updateDisplayInfo('Clipboard can be sent after VNC connects.');
            return;
        }
        const boundedText = boundedVncClientClipboardText(text);
        if (this.clipboardInputEl && this.clipboardInputEl.value !== boundedText) this.clipboardInputEl.value = boundedText;
        this.socketBoundary.send(encodeVncClientCutText(boundedText));
        this.clipboardStatus('Clipboard sent to remote.');
        this.updateDisplayInfo(`Clipboard sent to remote (${boundedText.length} chars).`);
        this.updateDisplayMeta();
    }

    private updateDisplayInfo(message) {
        if (this.displayInfoEl) {
            this.displayInfoEl.textContent = String(message || '');
        }
    }

    private updateDisplayMeta(extra = '') {
        if (!this.displayMetaEl) return;
        const protocolState = this.protocol?.state ? `state=${this.protocol.state}` : 'state=idle';
        const size = this.protocol?.framebufferWidth && this.protocol?.framebufferHeight
            ? `${this.protocol.framebufferWidth}×${this.protocol.framebufferHeight}`
            : 'pending';
        const name = this.protocol?.serverName ? ` · name=${this.protocol.serverName}` : '';
        const scale = this.displayScale ? ` · scale=${Math.round(this.displayScale * 100)}%` : '';
        const suffix = extra ? ` · ${extra}` : '';
        this.displayMetaEl.textContent = `${protocolState} · framebuffer=${size}${name}${scale}${suffix}`;
    }

    private ensureCanvasSize(width, height, options: { reveal?: boolean } = {}) {
        if (!this.canvas || !this.canvasCtx || !width || !height) return;
        const w = Math.max(1, Math.floor(Number(width || 0)));
        const h = Math.max(1, Math.floor(Number(height || 0)));
        if (!isVncFramebufferSizeAllowed(w, h)) {
            throw new Error(`VNC framebuffer too large: ${w}×${h}`);
        }
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        const reveal = options?.reveal === true;
        this.canvas.style.display = reveal || this.hasRenderedFrame ? 'block' : 'none';
        this.canvas.style.aspectRatio = `${w} / ${h}`;

        this.updateCanvasScale();
    }

    private attachDisplayResizeObserver() {
        if (!this.displayStageEl || typeof ResizeObserver === 'undefined') return;
        try { this.resizeObserver?.disconnect?.(); } catch { /* expected: prior resize observer may already be disconnected before re-attachment. */ }
        this.resizeObserver = new ResizeObserver(() => {
            this.updateCanvasScale();
        });
        this.resizeObserver.observe(this.displayStageEl);
    }

    private updateCanvasScale() {
        if (!this.canvas || !this.displayStageEl || !this.canvas.width || !this.canvas.height) return;
        // Defer to next frame so the layout is stable after reveal/resize
        requestAnimationFrame(() => {
            if (!this.canvas || !this.displayStageEl) return;
            const bounds = this.displayStageEl.getBoundingClientRect?.();
            const availableWidth = Math.max(1, Math.floor(bounds?.width || this.displayStageEl.clientWidth || 0));
            const availableHeight = Math.max(1, Math.floor(bounds?.height || this.displayStageEl.clientHeight || 0));
            if (!availableWidth || !availableHeight) return;
            const scale = computeContainedRemoteDisplayScale(availableWidth, availableHeight, this.canvas.width, this.canvas.height);
            this.displayScale = scale;
            this.canvas.style.width = `${Math.max(1, Math.round(this.canvas.width * scale))}px`;
            this.canvas.style.height = `${Math.max(1, Math.round(this.canvas.height * scale))}px`;
            this.updateDisplayMeta();
        });
    }

    private getFramebufferPointFromEvent(event) {
        if (!this.canSendInput() || !this.canvas || !this.protocol?.framebufferWidth || !this.protocol?.framebufferHeight) return null;
        const rect = this.canvas.getBoundingClientRect?.();
        if (!rect || !rect.width || !rect.height) return null;
        return mapClientToFramebufferPoint(event.clientX, event.clientY, rect, this.protocol.framebufferWidth, this.protocol.framebufferHeight);
    }

    private sendPointerEvent(buttonMask, x, y) {
        if (!this.socketBoundary || !this.protocol || this.protocol.state !== 'connected') return;
        this.socketBoundary.send(encodeVncPointerEvent(buttonMask, x, y));
    }

    private attachCanvasPointerHandlers() {
        if (!this.canvas || this.readOnly) return;
        this.canvas.style.cursor = 'crosshair';
        this.canvas.style.touchAction = 'none';

        try { this.pointerInputAbortController?.abort?.(); } catch { /* expected: replacing pointer listeners during canvas swaps can race. */ }
        const abortController = new AbortController();
        this.pointerInputAbortController = abortController;
        const signal = abortController.signal;
        const ownerDocument = this.canvas.ownerDocument || document;
        const ownerWindow = ownerDocument.defaultView || window;

        // Track pressed mask and last-known framebuffer point per pointer so touch/pen
        // releases still work even when Safari reports button=-1 or delivers pointerup
        // to the window instead of the canvas.
        const pressedMaskByPointer = new Map<number, number>();
        const lastPointByPointer = new Map<number, { x: number; y: number }>();
        const idleReleaseTimerByPointer = new Map<number, ReturnType<typeof setTimeout>>();
        const pendingTouchByPointer = new Map<number, {
            startClientX: number;
            startClientY: number;
            lastClientX: number;
            lastClientY: number;
            startedAt: number;
            lastPoint: { x: number; y: number };
            holdTimer: ReturnType<typeof setTimeout> | null;
            dragActivated: boolean;
        }>();
        const activeTouchPointerIds = new Set<number>();
        let suppressTouchUntilAllReleased = false;

        const resolvePoint = (event) => this.getFramebufferPointFromEvent(event)
            || lastPointByPointer.get(event?.pointerId)
            || { x: 0, y: 0 };

        const resolveTouchPoint = (touch) => {
            if (!touch || !this.canvas || !this.protocol?.framebufferWidth || !this.protocol?.framebufferHeight) return null;
            const rect = this.canvas.getBoundingClientRect?.();
            if (!rect || !rect.width || !rect.height) return null;
            return mapClientToFramebufferPoint(touch.clientX, touch.clientY, rect, this.protocol.framebufferWidth, this.protocol.framebufferHeight);
        };

        const clearIdleReleaseTimer = (pointerId) => {
            const handle = idleReleaseTimerByPointer.get(pointerId);
            if (handle) {
                ownerWindow.clearTimeout(handle);
                idleReleaseTimerByPointer.delete(pointerId);
            }
        };

        const clearPendingTouch = (pointerId) => {
            const pendingTouch = pendingTouchByPointer.get(pointerId);
            if (pendingTouch?.holdTimer) {
                ownerWindow.clearTimeout(pendingTouch.holdTimer);
            }
            pendingTouchByPointer.delete(pointerId);
        };

        const clearAllPendingTouches = () => {
            for (const pointerId of pendingTouchByPointer.keys()) {
                clearPendingTouch(pointerId);
            }
        };

        const maybeClearTouchSuppression = () => {
            if (!activeTouchPointerIds.size) {
                suppressTouchUntilAllReleased = false;
            }
        };

        const armIdleReleaseTimer = (event, delayMs = 80) => {
            const pointerType = String(event?.pointerType || '').toLowerCase();
            if (!shouldArmVncImplicitReleaseTimer(pointerType)) return;
            const pointerId = Number(event?.pointerId);
            if (!Number.isFinite(pointerId)) return;
            clearIdleReleaseTimer(pointerId);
            const handle = ownerWindow.setTimeout(() => {
                idleReleaseTimerByPointer.delete(pointerId);
                if (!pressedMaskByPointer.has(pointerId) && !this.pointerButtonMask) return;
                // Safari on iPad can terminate the contact stream without any final
                // pointerup/touchend. Release the pressed button after a short idle
                // period so taps do not remain stuck forever.
                releasePointer({
                    pointerId,
                    pointerType,
                    type: 'pointercancel',
                    clientX: event?.clientX,
                    clientY: event?.clientY,
                }, { resetAll: true });
            }, delayMs);
            idleReleaseTimerByPointer.set(pointerId, handle);
        };

        const releaseAllPointers = (point = null) => {
            if (!pressedMaskByPointer.size && !this.pointerButtonMask && !pendingTouchByPointer.size) return;
            for (const pointerId of idleReleaseTimerByPointer.keys()) {
                clearIdleReleaseTimer(pointerId);
            }
            clearAllPendingTouches();
            activeTouchPointerIds.clear();
            suppressTouchUntilAllReleased = false;
            const fallbackPoint = point
                || lastPointByPointer.values().next().value
                || { x: 0, y: 0 };
            pressedMaskByPointer.clear();
            lastPointByPointer.clear();
            this.pointerButtonMask = 0;
            this.sendPointerEvent(0, fallbackPoint.x, fallbackPoint.y);
        };

        const releasePointer = (event, options: { resetAll?: boolean } = {}) => {
            if (options.resetAll) {
                const pointerId = Number(event?.pointerId);
                clearIdleReleaseTimer(pointerId);
                releaseAllPointers(resolvePoint(event));
                try { this.canvas?.releasePointerCapture?.(pointerId); } catch { /* expected: capture may already be gone on release/cancel. */ }
                return;
            }
            const point = resolvePoint(event);
            const pointerId = Number(event?.pointerId);
            clearIdleReleaseTimer(pointerId);
            clearPendingTouch(pointerId);
            activeTouchPointerIds.delete(pointerId);
            maybeClearTouchSuppression();
            const hadPressedMask = pressedMaskByPointer.has(pointerId);
            const pressedBit = pressedMaskByPointer.get(pointerId) ?? resolveVncPointerPressMask(event);
            if (!hadPressedMask && !pressedBit && !this.pointerButtonMask) return;
            pressedMaskByPointer.delete(pointerId);
            lastPointByPointer.delete(pointerId);
            if (pressedBit) {
                this.pointerButtonMask &= ~pressedBit;
            } else if (!pressedMaskByPointer.size) {
                this.pointerButtonMask = 0;
            }
            this.sendPointerEvent(this.pointerButtonMask, point.x, point.y);
            try { this.canvas?.releasePointerCapture?.(pointerId); } catch { /* expected: capture may already be gone on release/cancel. */ }
        };

        const beginDeferredTouchDrag = (pointerId) => {
            if (suppressTouchUntilAllReleased) return;
            const pendingTouch = pendingTouchByPointer.get(pointerId);
            if (!pendingTouch || pendingTouch.dragActivated) return;
            pendingTouch.dragActivated = true;
            pendingTouch.holdTimer = null;
            const bit = vncButtonMaskForPointerButton(0);
            if (!bit) return;
            pressedMaskByPointer.set(pointerId, (pressedMaskByPointer.get(pointerId) ?? 0) | bit);
            this.pointerButtonMask |= bit;
            armIdleReleaseTimer({
                pointerId,
                pointerType: 'touch',
                clientX: pendingTouch.lastClientX,
                clientY: pendingTouch.lastClientY,
            });
            this.sendPointerEvent(this.pointerButtonMask, pendingTouch.lastPoint.x, pendingTouch.lastPoint.y);
        };

        const finalizeDeferredTouch = (pointerId, point, options: { clientX?: number; clientY?: number; cancelled?: boolean } = {}) => {
            const pendingTouch = pendingTouchByPointer.get(pointerId);
            if (!pendingTouch) return false;
            const fallbackPoint = point || pendingTouch.lastPoint || { x: 0, y: 0 };
            const fallbackClientX = Number.isFinite(options.clientX) ? Number(options.clientX) : pendingTouch.lastClientX;
            const fallbackClientY = Number.isFinite(options.clientY) ? Number(options.clientY) : pendingTouch.lastClientY;
            activeTouchPointerIds.delete(pointerId);

            if (options.cancelled || suppressTouchUntilAllReleased) {
                clearPendingTouch(pointerId);
                maybeClearTouchSuppression();
                if (pressedMaskByPointer.has(pointerId) || this.pointerButtonMask) {
                    releaseAllPointers(fallbackPoint);
                }
                return true;
            }

            if (pendingTouch.dragActivated || pressedMaskByPointer.has(pointerId)) {
                releasePointer({
                    pointerId,
                    pointerType: 'touch',
                    type: 'pointerup',
                    clientX: fallbackClientX,
                    clientY: fallbackClientY,
                });
                maybeClearTouchSuppression();
                return true;
            }

            const elapsedMs = Date.now() - pendingTouch.startedAt;
            const shouldTap = shouldTriggerVncTouchTap({
                startX: pendingTouch.startClientX,
                startY: pendingTouch.startClientY,
                clientX: fallbackClientX,
                clientY: fallbackClientY,
                elapsedMs,
            });
            clearIdleReleaseTimer(pointerId);
            clearPendingTouch(pointerId);
            lastPointByPointer.delete(pointerId);
            maybeClearTouchSuppression();
            if (shouldTap) {
                const bit = vncButtonMaskForPointerButton(0);
                this.sendPointerEvent(bit, fallbackPoint.x, fallbackPoint.y);
                this.sendPointerEvent(0, fallbackPoint.x, fallbackPoint.y);
            } else {
                this.sendPointerEvent(this.pointerButtonMask, fallbackPoint.x, fallbackPoint.y);
            }
            return true;
        };

        this.releasePointers = () => releaseAllPointers();
        this.canvas.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        }, { signal });
        this.canvas.addEventListener('pointermove', (event) => {
            const point = this.getFramebufferPointFromEvent(event);
            if (!point) return;
            const pointerType = String(event?.pointerType || '').toLowerCase();
            const isDeferredTouch = isVncDeferredTouchPointerType(pointerType);
            lastPointByPointer.set(event.pointerId, point);

            if (isDeferredTouch) {
                const pendingTouch = pendingTouchByPointer.get(event.pointerId);
                if (pendingTouch) {
                    pendingTouch.lastClientX = Number(event?.clientX || 0);
                    pendingTouch.lastClientY = Number(event?.clientY || 0);
                    pendingTouch.lastPoint = point;
                    if (!pendingTouch.dragActivated && hasVncTouchTapSlopBeenExceeded({
                        startX: pendingTouch.startClientX,
                        startY: pendingTouch.startClientY,
                        clientX: pendingTouch.lastClientX,
                        clientY: pendingTouch.lastClientY,
                    })) {
                        clearPendingTouch(event.pointerId);
                        pendingTouchByPointer.set(event.pointerId, {
                            ...pendingTouch,
                            holdTimer: null,
                            dragActivated: false,
                        });
                    }
                    if (!pendingTouch.dragActivated) {
                        this.sendPointerEvent(this.pointerButtonMask, point.x, point.y);
                        return;
                    }
                }
                if (suppressTouchUntilAllReleased) return;
            }

            if (pressedMaskByPointer.has(event.pointerId) && shouldReleaseVncPointerContact(event)) {
                // Safari on iPad can drop pointerup for touch/pen. Treat zero-buttons,
                // zero-pressure, and similar terminal pointer states as an implicit release.
                releasePointer(event, { resetAll: true });
                return;
            }
            // Cross-pointer release: after Apple Pencil lifts, hover events may
            // arrive with a different pointerId (contact vs hover streams).  If
            // those events show buttons=0 while we still have a pressed VNC mask,
            // release everything so the server does not see a stuck button.
            if (this.pointerButtonMask && !pressedMaskByPointer.has(event.pointerId) && shouldReleaseVncPointerContact(event)) {
                releaseAllPointers(point);
                return;
            }
            if (pressedMaskByPointer.has(event.pointerId)) {
                armIdleReleaseTimer(event);
            }
            this.sendPointerEvent(this.pointerButtonMask, point.x, point.y);
        }, { signal });
        this.canvas.addEventListener('pointerdown', (event) => {
            const point = this.getFramebufferPointFromEvent(event);
            if (!point) return;
            const pointerType = String(event?.pointerType || '').toLowerCase();
            const isDeferredTouch = isVncDeferredTouchPointerType(pointerType);
            event.preventDefault();
            this.canvas?.focus?.();
            lastPointByPointer.set(event.pointerId, point);

            if (isDeferredTouch) {
                activeTouchPointerIds.add(event.pointerId);
                if (activeTouchPointerIds.size > 1) {
                    const touchIds = [...activeTouchPointerIds];
                    suppressTouchUntilAllReleased = true;
                    releaseAllPointers(point);
                    for (const touchPointerId of touchIds) {
                        activeTouchPointerIds.add(touchPointerId);
                    }
                    suppressTouchUntilAllReleased = true;
                    return;
                }
                clearPendingTouch(event.pointerId);
                const pendingTouch = {
                    startClientX: Number(event?.clientX || 0),
                    startClientY: Number(event?.clientY || 0),
                    lastClientX: Number(event?.clientX || 0),
                    lastClientY: Number(event?.clientY || 0),
                    startedAt: Date.now(),
                    lastPoint: point,
                    holdTimer: null,
                    dragActivated: false,
                };
                pendingTouch.holdTimer = ownerWindow.setTimeout(() => {
                    beginDeferredTouchDrag(event.pointerId);
                }, 260);
                pendingTouchByPointer.set(event.pointerId, pendingTouch);
                this.sendPointerEvent(this.pointerButtonMask, point.x, point.y);
                return;
            }

            // Only capture for mouse; touch/pen capture on iPad Safari can
            // suppress pointerup entirely (WebKit bug), leaving clicks stuck.
            if (pointerType === 'mouse') {
                try { this.canvas?.setPointerCapture?.(event.pointerId); } catch { /* expected: pointer capture can fail when Safari drops the stream mid-gesture. */ }
            }
            const bit = resolveVncPointerPressMask(event);
            if (!bit) return;
            pressedMaskByPointer.set(event.pointerId, (pressedMaskByPointer.get(event.pointerId) ?? 0) | bit);
            this.pointerButtonMask |= bit;
            armIdleReleaseTimer(event);
            this.sendPointerEvent(this.pointerButtonMask, point.x, point.y);
        }, { signal, passive: false });
        this.canvas.addEventListener('pointerup', (event) => {
            event.preventDefault();
            if (isVncDeferredTouchPointerType(event?.pointerType)) {
                const point = resolvePoint(event);
                if (finalizeDeferredTouch(event.pointerId, point, { clientX: event?.clientX, clientY: event?.clientY })) return;
            }
            releasePointer(event);
        }, { signal, passive: false });
        this.canvas.addEventListener('pointercancel', (event) => {
            event.preventDefault();
            if (isVncDeferredTouchPointerType(event?.pointerType)) {
                const point = resolvePoint(event);
                if (finalizeDeferredTouch(event.pointerId, point, { clientX: event?.clientX, clientY: event?.clientY, cancelled: true })) return;
            }
            releasePointer(event, { resetAll: true });
        }, { signal, passive: false });
        this.canvas.addEventListener('pointerleave', (event) => {
            if (pendingTouchByPointer.has(event.pointerId) && isVncDeferredTouchPointerType(event?.pointerType)) {
                finalizeDeferredTouch(event.pointerId, resolvePoint(event), { clientX: event?.clientX, clientY: event?.clientY, cancelled: true });
                return;
            }
            if (!pressedMaskByPointer.has(event.pointerId)) return;
            if (!shouldReleaseVncPointerContact(event)) return;
            releasePointer(event, { resetAll: true });
        }, { signal });
        this.canvas.addEventListener('pointerout', (event) => {
            if (pendingTouchByPointer.has(event.pointerId) && isVncDeferredTouchPointerType(event?.pointerType)) {
                finalizeDeferredTouch(event.pointerId, resolvePoint(event), { clientX: event?.clientX, clientY: event?.clientY, cancelled: true });
                return;
            }
            if (!pressedMaskByPointer.has(event.pointerId)) return;
            if (!shouldReleaseVncPointerContact(event)) return;
            releasePointer(event, { resetAll: true });
        }, { signal });
        this.canvas.addEventListener('lostpointercapture', (event) => {
            releasePointer(event, { resetAll: true });
        }, { signal });
        ownerWindow.addEventListener('pointermove', (event) => {
            if ((!pressedMaskByPointer.size && !this.pointerButtonMask) || !shouldReleaseVncPointerContact(event)) return;
            if (!pressedMaskByPointer.has(event.pointerId) && !this.pointerButtonMask) return;
            releasePointer(event, { resetAll: true });
        }, { signal });
        ownerWindow.addEventListener('pointerup', (event) => {
            if (!pressedMaskByPointer.has(event.pointerId) && !this.pointerButtonMask && !pendingTouchByPointer.has(event.pointerId)) return;
            event.preventDefault?.();
            if (isVncDeferredTouchPointerType(event?.pointerType)) {
                const point = resolvePoint(event);
                if (finalizeDeferredTouch(event.pointerId, point, { clientX: event?.clientX, clientY: event?.clientY })) return;
            }
            releasePointer(event, { resetAll: !pressedMaskByPointer.has(event.pointerId) });
        }, { signal, passive: false });
        ownerWindow.addEventListener('pointercancel', (event) => {
            if (!pressedMaskByPointer.has(event.pointerId) && !this.pointerButtonMask && !pendingTouchByPointer.has(event.pointerId)) return;
            event.preventDefault?.();
            if (isVncDeferredTouchPointerType(event?.pointerType)) {
                const point = resolvePoint(event);
                if (finalizeDeferredTouch(event.pointerId, point, { clientX: event?.clientX, clientY: event?.clientY, cancelled: true })) return;
            }
            releasePointer(event, { resetAll: true });
        }, { signal, passive: false });
        const releaseFromTouchEvent = (event) => {
            if (!pressedMaskByPointer.size && !this.pointerButtonMask && !pendingTouchByPointer.size) return;
            if (!shouldReleaseVncTouchContact(event)) return;
            const changedTouch = event?.changedTouches?.[0] || event?.touches?.[0] || null;
            const point = resolveTouchPoint(changedTouch)
                || lastPointByPointer.values().next().value
                || pendingTouchByPointer.values().next().value?.lastPoint
                || { x: 0, y: 0 };
            if (!pressedMaskByPointer.size && !this.pointerButtonMask && pendingTouchByPointer.size === 1) {
                const [pointerId] = pendingTouchByPointer.entries().next().value || [];
                if (Number.isFinite(pointerId)) {
                    finalizeDeferredTouch(pointerId, point, {
                        clientX: changedTouch?.clientX,
                        clientY: changedTouch?.clientY,
                        cancelled: event?.type === 'touchcancel',
                    });
                    return;
                }
            }
            releaseAllPointers(point);
        };
        const releaseFromWindowPointerEvent = (event, options: { resetAll?: boolean } = {}) => {
            if (!pressedMaskByPointer.size && !this.pointerButtonMask && !pendingTouchByPointer.has(event?.pointerId)) return;
            if (!shouldReleaseVncPointerContact(event)) return;
            event?.preventDefault?.();
            if (isVncDeferredTouchPointerType(event?.pointerType)) {
                const point = resolvePoint(event);
                if (finalizeDeferredTouch(event.pointerId, point, {
                    clientX: event?.clientX,
                    clientY: event?.clientY,
                    cancelled: options.resetAll === true,
                })) return;
            }
            releasePointer(event, {
                resetAll: options.resetAll === true || !pressedMaskByPointer.has(event?.pointerId),
            });
        };
        this.canvas.addEventListener('touchend', releaseFromTouchEvent, { signal, passive: true, capture: true });
        this.canvas.addEventListener('touchcancel', releaseFromTouchEvent, { signal, passive: true, capture: true });
        ownerDocument.addEventListener('touchend', releaseFromTouchEvent, { signal, passive: true, capture: true });
        ownerDocument.addEventListener('touchcancel', releaseFromTouchEvent, { signal, passive: true, capture: true });
        ownerWindow.addEventListener('touchend', releaseFromTouchEvent, { signal, passive: true, capture: true });
        ownerWindow.addEventListener('touchcancel', releaseFromTouchEvent, { signal, passive: true, capture: true });
        ownerDocument.addEventListener('pointerup', (event) => {
            releaseFromWindowPointerEvent(event);
        }, { signal, passive: false, capture: true });
        ownerDocument.addEventListener('pointercancel', (event) => {
            releaseFromWindowPointerEvent(event, { resetAll: true });
        }, { signal, passive: false, capture: true });
        ownerWindow.addEventListener('mouseup', () => {
            if (!pressedMaskByPointer.size && !this.pointerButtonMask && !pendingTouchByPointer.size) return;
            releaseAllPointers();
        }, { signal });
        ownerWindow.addEventListener('blur', () => {
            if (!pressedMaskByPointer.size && !this.pointerButtonMask && !pendingTouchByPointer.size) return;
            releaseAllPointers();
        }, { signal });
        ownerDocument.addEventListener('visibilitychange', () => {
            if (ownerDocument.visibilityState === 'hidden') {
                releaseAllPointers();
            }
        }, { signal });
        this.canvas.addEventListener('wheel', (event) => {
            const point = this.getFramebufferPointFromEvent(event);
            if (!point) return;
            event.preventDefault();
            for (const payload of buildVncWheelPointerEvents(event.deltaY, point.x, point.y, this.pointerButtonMask)) {
                this.socketBoundary?.send?.(payload);
            }
        }, { signal, passive: false });
    }

    private sendKeyEvent(down, keysym) {
        if (!this.socketBoundary || !this.protocol || this.protocol.state !== 'connected') return;
        this.socketBoundary.send(encodeVncKeyEvent(down, keysym));
    }

    private releasePressedKeys() {
        for (const keysym of this.pressedKeysyms.values()) {
            this.sendKeyEvent(false, keysym);
        }
        this.pressedKeysyms.clear();
    }

    private attachCanvasKeyboardHandlers() {
        if (!this.canvas || this.readOnly) return;
        this.canvas.addEventListener('keydown', (event) => {
            if (!this.canSendInput()) return;
            const keysym = resolveVncKeysymFromKeyboardEvent(event);
            if (keysym == null) return;
            const keyId = event.code || event.key;
            const existingKeysym = this.pressedKeysyms.get(keyId);
            if (shouldSkipDuplicateVncKeydown(existingKeysym, keysym, event.repeat)) {
                event.preventDefault();
                return;
            }
            event.preventDefault();
            this.pressedKeysyms.set(keyId, keysym);
            this.sendKeyEvent(true, keysym);
        });
        this.canvas.addEventListener('keyup', (event) => {
            if (!this.canSendInput()) return;
            const keyId = event.code || event.key;
            const keysym = this.pressedKeysyms.get(keyId) ?? resolveVncKeysymFromKeyboardEvent(event);
            if (keysym == null) return;
            event.preventDefault();
            this.pressedKeysyms.delete(keyId);
            this.sendKeyEvent(false, keysym);
        });
        this.canvas.addEventListener('blur', () => {
            this.releasePressedKeys();
        });
    }

    private drawRgbaRect(rect) {
        if (!this.canvasCtx || !this.canvas) return;
        this.ensureCanvasSize(this.canvas.width || rect.width, this.canvas.height || rect.height, { reveal: true });
        const imageData = new ImageData(rect.rgba, rect.width, rect.height);
        this.canvasCtx.putImageData(imageData, rect.x, rect.y);
        this.hasRenderedFrame = true;
    }

    private copyCanvasRect(rect) {
        if (!this.canvasCtx || !this.canvas) return;
        this.ensureCanvasSize(this.canvas.width || rect.width, this.canvas.height || rect.height, { reveal: true });
        const imageData = this.canvasCtx.getImageData(rect.srcX, rect.srcY, rect.width, rect.height);
        this.canvasCtx.putImageData(imageData, rect.x, rect.y);
        this.hasRenderedFrame = true;
    }

    private applyCursorRect(rect) {
        if (!this.canvas) return;
        if (!isVncCursorRectAllowed(rect)) {
            this.canvas.style.cursor = 'default';
            return;
        }
        const cursorCanvas = document.createElement('canvas');
        cursorCanvas.width = rect.width;
        cursorCanvas.height = rect.height;
        const ctx = cursorCanvas.getContext('2d');
        if (!ctx) return;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(rect.rgba), rect.width, rect.height), 0, 0);
        const hotX = Math.max(0, Math.min(rect.width - 1, Number(rect.x || 0)));
        const hotY = Math.max(0, Math.min(rect.height - 1, Number(rect.y || 0)));
        this.canvas.style.cursor = `url(${cursorCanvas.toDataURL('image/png')}) ${hotX} ${hotY}, default`;
    }

    private scheduleRawFallbackTimeout() {
        if (this.frameTimeoutId) {
            clearTimeout(this.frameTimeoutId);
            this.frameTimeoutId = null;
        }
        if (this.rawFallbackAttempted || this.protocolRecovering) return;
        this.frameTimeoutId = setTimeout(() => {
            if (this.hasRenderedFrame || this.rawFallbackAttempted || this.protocolRecovering) return;
            if (this.protocol && this.socketBoundary) {
                this.rawFallbackAttempted = true;
                this.protocolRecovering = true;
                this.setStatus('No framebuffer update yet; retrying with RAW encoding.');
                this.updateDisplayInfo('No framebuffer update yet. Retrying with RAW encoding.');
                this.updateDisplayMeta('reconnect-encoding-fallback');
                void this.connectWithEncodings('0');
            }
        }, 2200);
    }

    private applyRemoteDisplayEvent(event) {
        if (!event) return;
        switch (event.type) {
            case 'protocol-version':
                this.setStatus(`Negotiated ${event.protocol.toUpperCase()} ${event.server} → ${event.client}.`);
                this.updateDisplayInfo(`Negotiated ${event.server} → ${event.client}.`);
                this.updateDisplayMeta();
                return;
            case 'security-types':
                this.setStatus(`Server offered security types: ${event.types.join(', ') || 'none'}.`);
                this.updateDisplayInfo(`Security types: ${event.types.join(', ') || 'none'}.`);
                this.updateDisplayMeta();
                return;
            case 'security-selected':
                this.setStatus(`Using ${event.protocol.toUpperCase()} security type ${event.label}.`);
                this.updateDisplayInfo(`Security: ${event.label}.`);
                this.updateDisplayMeta();
                return;
            case 'security-result':
                this.setStatus('Security negotiation complete. Waiting for server init…');
                this.updateDisplayInfo('Security negotiation complete. Waiting for server init…');
                this.updateDisplayMeta();
                return;
            case 'display-init':
                this.ensureCanvasSize(event.width, event.height);
                this.setConnectionState('connecting', 'Waiting for the first framebuffer…');
                this.setStatus(`Connected to ${this.targetLabel || this.targetId || 'target'} — waiting for first framebuffer update (${event.width}×${event.height}).`);
                this.updateDisplayInfo(`Connected to ${event.name || this.targetLabel || this.targetId || 'remote display'}. Waiting for first framebuffer update…`);
                this.updateDisplayMeta('awaiting-frame');
                this.scheduleRawFallbackTimeout();
                return;
            case 'framebuffer-update': {
                if (this.frameTimeoutId) {
                    clearTimeout(this.frameTimeoutId);
                    this.frameTimeoutId = null;
                }
                let painted = false;

                // Pipeline mode: WASM owns the full framebuffer — paint it in one
                // putImageData call instead of iterating individual rects.
                const hasPipelineRects = (event.rects || []).some(r => r.kind === 'pipeline');
                if (event.framebuffer && event.framebuffer.length > 0 && event.width > 0 && event.height > 0 && hasPipelineRects) {
                    this.ensureCanvasSize(event.width, event.height, { reveal: true });
                    for (const rect of event.rects || []) {
                        if (rect.kind === 'resize') {
                            this.ensureCanvasSize(rect.width, rect.height);
                        } else if (rect.kind === 'cursor') {
                            this.applyCursorRect(rect);
                        } else if (rect.kind === 'desktop-name') {
                            this.targetLabel = rect.name || this.targetLabel;
                        }
                    }
                    const ctx = this.canvas?.getContext('2d', { alpha: false });
                    if (ctx) {
                        const img = new ImageData(new Uint8ClampedArray(event.framebuffer), event.width, event.height);
                        ctx.putImageData(img, 0, 0);
                        painted = true;
                    }
                } else {
                    // Non-pipeline mode: per-rect rendering
                    for (const rect of event.rects || []) {
                        if (rect.kind === 'resize') {
                            this.ensureCanvasSize(rect.width, rect.height);
                            continue;
                        }
                        if (rect.kind === 'copy') {
                            this.ensureCanvasSize(event.width, event.height, { reveal: true });
                            this.copyCanvasRect(rect);
                            painted = true;
                            continue;
                        }
                        if (rect.kind === 'cursor') {
                            this.applyCursorRect(rect);
                            continue;
                        }
                        if (rect.kind === 'desktop-name') {
                            this.targetLabel = rect.name || this.targetLabel;
                            continue;
                        }
                        if (rect.kind === 'rgba') {
                            this.ensureCanvasSize(event.width, event.height, { reveal: true });
                            this.drawRgbaRect(rect);
                            painted = true;
                        }
                    }
                }
                if (painted || this.hasRenderedFrame) {
                    this.hasRenderedFrame = true;
                    if (!this.connected) {
                        this.connected = true; this.reconnectAttempts = 0;
                        this.setConnectionState('connected', this.readOnly ? 'Connected · Read-only' : 'Connected');
                        this.setSessionChromeVisible(false);
                        this.focus();
                        if(!this.recordedSuccess){recordVncSuccess(this.historyStorage,this.targetId,this.targetLabel);this.recordedSuccess=true;}
                    }
                    this.protocolRecovering = false;
                    this.setStatus(`Rendering live framebuffer — ${event.width}×${event.height}.`);
                    this.updateDisplayInfo(`Framebuffer update applied (${(event.rects || []).length} rect${(event.rects || []).length === 1 ? '' : 's'}).`);
                    this.updateDisplayMeta();
                } else {
                    this.setStatus(`Connected to ${this.targetLabel || this.targetId || 'target'} — waiting for painted framebuffer data.`);
                    this.updateDisplayInfo(`Framebuffer update received, but no paintable rects yet (${(event.rects || []).length} rect${(event.rects || []).length === 1 ? '' : 's'}).`);
                    this.updateDisplayMeta('awaiting-frame');
                    this.scheduleRawFallbackTimeout();
                }
                return;
            }
            case 'clipboard': {
                const text = boundedVncClientClipboardText(event.text || '');
                this.remoteClipboard = text;
                if (this.clipboardInputEl) this.clipboardInputEl.value = text;
                this.setStatus('Remote clipboard updated.');
                this.updateDisplayInfo(`Clipboard text received (${text.length} chars).`);
                this.updateDisplayMeta();
                return;
            }
            case 'bell':
                this.setStatus('Remote display bell received.');
                this.updateDisplayInfo('Remote display bell received.');
                this.updateDisplayMeta();
                return;
        }
    }

    private async handleSocketMessage(message) {
        const generation = this.connectionGeneration;
        if (message?.kind === 'control') {
            const payload = message.payload;
            if (payload?.type === 'vnc.error') {
                this.connected = false; this.setConnectionState('error', payload.error || 'VNC proxy failed'); this.setSessionChromeVisible(true);
                this.setStatus(`Proxy error: ${payload.error || 'Unknown error'}`);
                this.updateDisplayInfo(`Proxy error: ${payload.error || 'Unknown error'}`);
                this.updateDisplayMeta('proxy-error');
                return;
            }
            if (payload?.type === 'vnc.connected') {
                const label = payload?.target?.label || this.targetLabel || this.targetId;
                this.setStatus(`Connected to ${label}. Waiting for VNC/RFB data…`);
                this.updateDisplayInfo(`Connected to ${label}. Waiting for VNC handshake…`);
                this.updateDisplayMeta();
                return;
            }
            if (payload?.type === 'pong') {
                return;
            }
            return;
        }

        const protocol = this.protocol || (this.protocol = new VncRemoteDisplayProtocol());
        try {
            const chunk = message.data instanceof Blob ? await message.data.arrayBuffer() : message.data;
            if (this.disposed || this.manuallyStopped || generation !== this.connectionGeneration) return;
            const result = protocol.receive(chunk);
            for (const outgoing of result.outgoing || []) {
                this.socketBoundary?.send?.(outgoing);
            }
            for (const event of result.events || []) {
                this.applyRemoteDisplayEvent(event);
            }
        } catch (error) {
            const message = error?.message || 'Unknown error';
            this.connected = false; this.setConnectionState('error', message);
            this.setSessionChromeVisible(true);
            if (/password|auth|security/i.test(message)) { this.stopConnection(); const auth=this.bodyEl.querySelector('[data-vnc-auth]'); if(auth) auth.open=true; this.passwordInputEl?.focus(); }
            this.setStatus(`Display protocol error: ${message}`);
            this.updateDisplayInfo(`Display protocol error: ${message}`);
            this.updateDisplayMeta('protocol-error');
            if (this.frameTimeoutId) {
                clearTimeout(this.frameTimeoutId);
                this.frameTimeoutId = null;
            }
            if (!this.rawFallbackAttempted && !this.protocolRecovering && /unexpected eof|zlib|decompress|protocol|buffer|undefined|not an object|reading '0'/i.test(message)) {
                this.rawFallbackAttempted = true;
                this.protocolRecovering = true;
                void this.connectWithEncodings('0');
            }
        }
    }

    private async connectSocket(preferredEncodings = null) {
        if (!this.targetId || this.disposed || this.manuallyStopped) return;
        const generation=++this.connectionGeneration;
        const target=this.targetId;
        this.releasePressedKeys(); this.releasePointers?.();
        this.connected=false; this.recordedSuccess=false;
        if(this.frameTimeoutId)clearTimeout(this.frameTimeoutId);this.frameTimeoutId=null;
        this.setConnectionState('connecting', 'Connecting…');
        this.clearReconnectTimer();
        if (this.protocolRecovering && preferredEncodings == null) {
            this.protocolRecovering = false;
        }

        try { this.socketBoundary?.dispose?.(); } catch { /* expected: previous socket boundary may already be torn down before reconnect. */ }

        if (preferredEncodings == null) {
            this.rawFallbackAttempted = false;
            this.protocolRecovering = false;
        }

        const handoffToken = this.pendingHandoffToken || null;

        const selectedEncodings = preferredEncodings == null ? null : String(preferredEncodings).trim();
        const wasmDecoder = await loadRemoteDisplayWasmDecoder();
        if(this.disposed || this.manuallyStopped || generation!==this.connectionGeneration || target!==this.targetId)return;
        const protocolOptions: any = {};
        if (wasmDecoder) {
            protocolOptions.pipeline = wasmDecoder;
            protocolOptions.decodeRawRect = (bytes, width, height, pixelFormat) =>
                wasmDecoder.decodeRawRectToRgba(bytes, width, height, pixelFormat);
        }
        const normalizedPassword = normalizeVncPassword(this.authPassword);
        if (normalizedPassword !== null) {
            protocolOptions.password = normalizedPassword;
        }
        if (selectedEncodings) {
            protocolOptions.encodings = selectedEncodings;
        }

        const preserveRenderedFrame = Boolean(this.canvas && this.hasRenderedFrame);
        this.protocol = new VncRemoteDisplayProtocol(protocolOptions);
        this.hasRenderedFrame = false;
        this.frameTimeoutId = null;

        if (this.canvas) {
            this.canvas.style.display = preserveRenderedFrame ? 'block' : 'none';
        }


        this.socketBoundary = new WebSocketRemoteDisplayBoundary({
            url: buildVncWebSocketUrl(this.targetId, handoffToken),
            binaryType: 'arraybuffer',
            onOpen: () => {
                if(generation!==this.connectionGeneration)return;
                if (handoffToken && this.pendingHandoffToken === handoffToken) {
                    this.pendingHandoffToken = null;
                }
                this.setStatus(`Connected to proxy for ${this.targetId}. Waiting for VNC/RFB data…`);
                this.updateDisplayInfo('WebSocket proxy connected. Waiting for handshake…');
                this.updateDisplayMeta();
                this.socketBoundary?.sendControl?.({ type: 'ping' });
            },
            onMetrics: (metrics) => {
                this.applyMetrics(metrics);
            },
            onMessage: (message) => {
                if(generation!==this.connectionGeneration)return;
                void this.handleSocketMessage(message);
            },
            onClose: () => {
                if(generation!==this.connectionGeneration || this.manuallyStopped)return;
                this.connected=false;this.setConnectionState('disconnected','Connection lost. Retry or choose Connections.');
                this.setSessionChromeVisible(true);
                if (this.frameTimeoutId) {
                    clearTimeout(this.frameTimeoutId);
                    this.frameTimeoutId = null;
                }
                if (this.disposed) return;
                if (shouldRetryVncPopoutWithoutHandoff({
                    handoffToken,
                    bytesIn: this.bytesIn,
                    hasRenderedFrame: this.hasRenderedFrame,
                    reconnectAttempts: this.reconnectAttempts,
                })) {
                    this.pendingHandoffToken = null;
                    this.setStatus('Transferred VNC session was not ready yet. Retrying…');
                    this.updateDisplayInfo('Transferred VNC session was not ready yet. Retrying without handoff…');
                    this.updateDisplayMeta('handoff-retrying');
                    this.scheduleReconnect(150);
                    return;
                }
                const shouldReconnect = this.bytesIn > 0 || this.hasRenderedFrame || this.reconnectAttempts > 0;
                if (shouldReconnect) {
                    this.setStatus('Remote display connection lost. Reconnecting…');
                    this.updateDisplayInfo('Remote display transport closed. Attempting to reconnect…');
                    this.updateDisplayMeta('reconnecting');
                    this.scheduleReconnect();
                    return;
                }
                this.setStatus(this.bytesIn > 0
                    ? `Proxy closed after receiving ${this.bytesIn} byte(s).`
                    : 'Proxy closed.');
                this.updateDisplayInfo(this.bytesIn > 0
                    ? 'Remote display transport closed after receiving data.'
                    : 'Remote display transport closed.');
                this.updateDisplayMeta('closed');
            },
            onError: () => {
                if(generation!==this.connectionGeneration || this.manuallyStopped)return;
                this.connected=false;this.setConnectionState('error','Connection failed. Retry or choose Connections.');
                this.setSessionChromeVisible(true);
                if (shouldRetryVncPopoutWithoutHandoff({
                    handoffToken,
                    bytesIn: this.bytesIn,
                    hasRenderedFrame: this.hasRenderedFrame,
                    reconnectAttempts: this.reconnectAttempts,
                })) {
                    this.pendingHandoffToken = null;
                    this.setStatus('Transferred VNC session was not ready yet. Retrying…');
                    this.updateDisplayInfo('Transferred VNC session was not ready yet. Retrying without handoff…');
                    this.updateDisplayMeta('handoff-retrying');
                    this.scheduleReconnect(150);
                    return;
                }
                const shouldReconnect = this.bytesIn > 0 || this.hasRenderedFrame || this.reconnectAttempts > 0;
                if (shouldReconnect) {
                    this.setStatus('WebSocket proxy connection failed. Reconnecting…');
                    this.updateDisplayInfo('WebSocket proxy connection failed. Attempting to reconnect…');
                    this.updateDisplayMeta('socket-reconnecting');
                    this.scheduleReconnect();
                    return;
                }
                this.setStatus('WebSocket proxy connection failed.');
                this.updateDisplayInfo('WebSocket proxy connection failed.');
                this.updateDisplayMeta('socket-error');
            },
        });
        this.socketBoundary.connect();
    }

    private connectWithEncodings(encodings) {
        return this.connectSocket(encodings);
    }

    private async load() {
        this.resetLiveSession();
        let generation=this.connectionGeneration;
        const target=this.targetId;
        this.setStatus('');
        this.bodyEl.innerHTML = '<p role="status">Loading connections…</p>';
        try {
            const payload = await fetchVncSession(target);
            if(this.disposed||generation!==this.connectionGeneration||target!==this.targetId)return;
            this.historyStorage = scopedVncHistoryStorage(getVncLocalStorage(), payload?.history_scope);
            if (!payload?.enabled) {
                this.renderTargets(payload);
                this.setStatus('');
                return;
            }
            if (!this.targetId) {
                this.renderTargets(payload);
                this.setStatus('');
                return;
            }
            this.renderTargetSession(payload);
            const connecting = this.connectSocket();
            generation=this.connectionGeneration;
            await connecting;
        } catch (error) {
            if(this.disposed||generation!==this.connectionGeneration)return;
            this.resetLiveSession();
            this.bodyEl.innerHTML = `
                <div style="max-width:620px;text-align:center;padding:28px;border:1px dashed var(--border-color);border-radius:14px;background:var(--bg-secondary);">
                    <div style="font-size:32px;margin-bottom:10px;">⚠️</div>
                    <div style="font-weight:600;margin-bottom:6px;">Failed to load VNC session</div>
                    <div style="color:var(--text-secondary);font-size:13px;line-height:1.5;">${esc(error?.message || 'Unknown error')}</div>
                </div>
            `;
            const back = document.createElement('button'); back.textContent = 'Connections'; back.onclick = () => { this.targetId=null; this.authPassword=null; void this.load(); }; this.bodyEl.append(back);
            this.setStatus(`Session load failed: ${error?.message || 'Unknown error'}`);
        }
    }

    beforeDetachFromHost() {
        this.releasePressedKeys(); this.releasePointers?.();
        this.setStatus('Moving VNC session…');
        this.updateDisplayInfo('Moving VNC session to a new window…');
        this.updateDisplayMeta('moving');
    }

    afterAttachToHost() {
        this.attachDisplayResizeObserver();
        this.updateCanvasScale();
        requestAnimationFrame(() => this.focus());
    }

    moveHost(container) {
        if (this.disposed || !this.root) return false;
        this.releasePressedKeys();
        this.container = container;
        installVncViewerStyles(container.ownerDocument || document);
        if (!relocateVncPaneRoot(this.root, container)) {
            return false;
        }
        this.afterAttachToHost();
        return true;
    }

    async preparePopoutTransfer() {
        return createVncPopoutTransferPayload(this.targetId, this.authPassword);
    }

    getContent() { return undefined; }
    isDirty() { return false; }
    focus() { if (this.chooserOverlay) return; if(this.chromeEl && !this.chromeEl.hidden) return; this.canvas?.focus?.(); }
    resize() { this.updateCanvasScale(); }
    dispose() {
        if (this.disposed) return;
        this.stopConnection();
        this.disposed = true;
        this.resetLiveSession();
        this.root?.remove?.();
    }
}

export const vncPaneExtension = {
    id: 'vnc-viewer',
    label: 'VNC',
    icon: 'display',
    capabilities: ['preview'] as PaneCapability[],
    placement: 'tabs',

    canHandle(context: PaneContext): boolean | number {
        const path = String(context?.path || '');
        return path === VNC_TAB_PREFIX || path.startsWith(`${VNC_TAB_PREFIX}/`) ? 9_000 : false;
    },

    mount(container: HTMLElement, context: PaneContext): PaneInstance {
        return new VncPaneInstance(container, context);
    },
} satisfies WebPaneExtension;
