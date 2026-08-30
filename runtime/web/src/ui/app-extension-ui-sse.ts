export interface ExtensionUiToastLike {
  title: string;
  detail: string | null;
  kind: string;
  durationMs?: number;
}

export interface ExtensionUiWorkingIndicatorState {
  mode: 'default' | 'custom' | 'hidden';
  frames: string[];
  intervalMs: number | null;
}

export interface ExtensionUiWorkingState {
  message: string | null;
  indicator: ExtensionUiWorkingIndicatorState | null;
  visible: boolean;
}

export interface StatusPanelWidgetEventContext {
  isStatusPanelWidgetEvent: boolean;
  eventChatJid: string;
  panelKey: string;
}

export function resolveStatusPanelEventChatJid(
  payload: Record<string, unknown> | null | undefined,
  currentChatJid: string,
): string {
  return typeof payload?.chat_jid === 'string' && payload.chat_jid.trim()
    ? payload.chat_jid.trim()
    : currentChatJid;
}

export function resolveStatusPanelWidgetEventContext(
  eventType: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
  currentChatJid: string,
): StatusPanelWidgetEventContext {
  return {
    isStatusPanelWidgetEvent: eventType === 'extension_ui_widget' && payload?.options?.surface === 'status-panel',
    eventChatJid: resolveStatusPanelEventChatJid(payload, currentChatJid),
    panelKey: typeof payload?.key === 'string' ? payload.key : '',
  };
}

function normalizeExtensionIndicatorFrame(frame: unknown): string | null {
  if (typeof frame !== 'string') return null;
  if (!frame) return null;
  // Extension working indicators must remain plain text frames so the same
  // payload can render in the web UI and Pi TUI.  Reject markup-like frames;
  // frontend-owned busy states use CSS/SVG spinners instead.
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(frame)) return null;
  return frame;
}

export function resolveExtensionUiWorkingIndicator(
  eventType: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): ExtensionUiWorkingIndicatorState | null | undefined {
  if (eventType !== 'extension_ui_working_indicator') return undefined;

  if (!Array.isArray(payload?.frames)) {
    return {
      mode: 'default',
      frames: [],
      intervalMs: null,
    };
  }

  const frames = payload.frames
    .map(normalizeExtensionIndicatorFrame)
    .filter((frame): frame is string => typeof frame === 'string');
  const intervalRaw = payload.interval_ms ?? payload.intervalMs;
  const intervalMs = typeof intervalRaw === 'number' && Number.isFinite(intervalRaw) && intervalRaw > 0
    ? intervalRaw
    : null;

  if (frames.length === 0) {
    return {
      mode: 'hidden',
      frames: [],
      intervalMs,
    };
  }

  return {
    mode: 'custom',
    frames,
    intervalMs,
  };
}

export function applyExtensionUiWorkingState(
  previous: ExtensionUiWorkingState,
  eventType: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): ExtensionUiWorkingState | undefined {
  if (eventType === 'extension_ui_working_visible') {
    const visible = payload?.visible !== false;
    if (visible === previous.visible) return undefined;
    return { ...previous, visible };
  }

  if (eventType === 'extension_ui_working') {
    return {
      message: typeof payload?.message === 'string' && payload.message.trim() ? payload.message.trim() : null,
      indicator: previous.indicator,
      visible: previous.visible,
    };
  }

  if (eventType === 'extension_ui_status') {
    // ctx.ui.setStatus(key, text) is the standard Pi extension progress path.
    // Keep structured status payloads such as context_usage out of the working
    // row, but let ordinary extension status text replace the generic
    // "Thinking…" fallback while an extension/tool is active.
    // CRITICAL: preserve the existing working indicator exactly as-is. Many
    // extensions set the indicator separately from status text, and losing it
    // makes active tool/extension progress look stalled or invisible.
    if (payload?.key === 'context_usage') return undefined;
    const rawText = typeof payload?.text === 'string' ? payload.text.trim() : '';
    const message = payload?.key === 'smart_compaction'
      ? rawText.replace(/^(?:(?:(?:Manual|Idle|Target-aware) smart compaction|Recovery compaction|Smart compaction):\s*)?(?:\d+%\s*[—-]\s*)?/i, '').trim()
      : rawText;
    return {
      message: message || null,
      indicator: previous.indicator,
      visible: previous.visible,
    };
  }

  const indicator = resolveExtensionUiWorkingIndicator(eventType, payload);
  if (indicator === undefined) return undefined;
  return {
    message: previous.message,
    indicator,
    visible: previous.visible,
  };
}

export function resolveExtensionUiContextUsage(
  eventType: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (eventType !== 'extension_ui_status') return null;
  if (payload?.key !== 'context_usage') return null;
  const raw = typeof payload?.text === 'string' ? payload.text.trim() : '';
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const data = parsed as Record<string, unknown>;
    const tokens = data.tokens == null ? null : Number(data.tokens);
    const contextWindow = data.contextWindow == null ? null : Number(data.contextWindow);
    const percent = data.percent == null ? null : Number(data.percent);
    const sessionGeneration = typeof (payload.sessionGeneration ?? data.sessionGeneration) === 'string'
      ? String(payload.sessionGeneration ?? data.sessionGeneration).trim()
      : '';
    return {
      tokens: Number.isFinite(tokens) ? tokens : null,
      contextWindow: Number.isFinite(contextWindow) ? contextWindow : null,
      percent: Number.isFinite(percent) ? percent : null,
      ...(sessionGeneration ? { sessionGeneration } : {}),
      estimated: data.estimated === true,
      source: typeof data.source === 'string' ? data.source : null,
      phase: typeof data.phase === 'string' ? data.phase : null,
    };
  } catch {
    return null;
  }
}

export function resolveExtensionUiToast(
  eventType: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): ExtensionUiToastLike | null {
  if (eventType === 'extension_ui_notify' && typeof payload?.message === 'string') {
    return {
      title: payload.message,
      detail: null,
      kind: typeof payload?.type === 'string' && payload.type.trim() ? payload.type : 'info',
    };
  }

  if (eventType === 'extension_ui_error') {
    const errorValue = payload?.error;
    const errorText = typeof errorValue === 'string'
      ? errorValue
      : (errorValue && typeof errorValue === 'object' && typeof (errorValue as Record<string, unknown>).error === 'string')
        ? (errorValue as Record<string, unknown>).error as string
        : (errorValue ? String(errorValue) : 'Unknown extension error');
    return {
      title: 'Extension UI error',
      detail: errorText,
      kind: 'error',
      durationMs: 5000,
    };
  }

  return null;
}
