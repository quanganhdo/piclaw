/**
 * web/push/web-notification-presence-service.ts – in-memory device/chat presence for notification routing.
 *
 * Tracks recent live browser clients by device + tab/window so reply delivery can distinguish:
 * - visible current chat on a device → no notification on that device
 * - hidden-but-live current chat on a device → local notification only on that device
 * - no live client for that chat on a device → Web Push allowed for that device
 */

export const DEFAULT_WEB_NOTIFICATION_PRESENCE_TTL_MS = 120000;

export interface WebNotificationPresenceRecord {
  deviceId: string;
  clientId: string;
  chatJid: string;
  visibilityState: "visible" | "hidden";
  hasFocus: boolean;
  updatedAtMs: number;
  userAgent: string | null;
  ownerUserId?: string;
  loginSessionId?: string;
}

export interface WebNotificationPresenceState {
  hasLiveClient: boolean;
  hasVisibleClient: boolean;
  clients: WebNotificationPresenceRecord[];
}

function normalizeTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyIosWebKitClient(userAgent: string | null | undefined): boolean {
  const normalized = normalizeTrimmedString(userAgent).toLowerCase();
  if (!normalized) return false;
  const isAppleMobileDevice = normalized.includes("iphone")
    || normalized.includes("ipad")
    || normalized.includes("ipod")
    || (normalized.includes("macintosh") && normalized.includes("mobile"));
  return isAppleMobileDevice && normalized.includes("applewebkit");
}

export function normalizeWebNotificationPresence(
  value: unknown,
  options: { nowMs?: number; userAgent?: string | null; ownerUserId?: string | null; loginSessionId?: string | null } = {},
): WebNotificationPresenceRecord | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const deviceId = normalizeTrimmedString(input.device_id ?? input.deviceId);
  const clientId = normalizeTrimmedString(input.client_id ?? input.clientId);
  const chatJid = normalizeTrimmedString(input.chat_jid ?? input.chatJid);
  if (!deviceId || !clientId || !chatJid) return null;

  const rawVisibility = normalizeTrimmedString(input.visibility_state ?? input.visibilityState).toLowerCase();
  const visibilityState = rawVisibility === "hidden" ? "hidden" : "visible";
  const hasFocus = Boolean(input.has_focus ?? input.hasFocus);
  const updatedAtMs = options.nowMs ?? Date.now();
  const ownerUserId = normalizeTrimmedString(options.ownerUserId);
  const loginSessionId = normalizeTrimmedString(options.loginSessionId);
  if (Boolean(ownerUserId) !== Boolean(loginSessionId)) return null;
  if (deviceId.length > 256 || clientId.length > 256 || chatJid.length > 512
    || ownerUserId.length > 256 || loginSessionId.length > 256) return null;

  return {
    deviceId,
    clientId,
    chatJid,
    visibilityState,
    hasFocus,
    updatedAtMs,
    userAgent: typeof options.userAgent === "string" && options.userAgent.trim() ? options.userAgent.trim() : null,
    ...(ownerUserId ? { ownerUserId, loginSessionId } : {}),
  };
}

export class WebNotificationPresenceService {
  private readonly records = new Map<string, WebNotificationPresenceRecord>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = Number.isFinite(options.ttlMs) ? Number(options.ttlMs) : DEFAULT_WEB_NOTIFICATION_PRESENCE_TTL_MS;
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
  }

  private buildKey(deviceId: string, clientId: string, ownerUserId?: string | null, chatJid?: string | null): string {
    return `${ownerUserId || ""}::${deviceId}::${clientId}::${chatJid || ""}`;
  }

  private isLive(record: WebNotificationPresenceRecord, nowMs = this.now()): boolean {
    return nowMs - record.updatedAtMs <= this.ttlMs;
  }

  prune(nowMs = this.now()): void {
    for (const [key, record] of this.records.entries()) {
      if (this.isLive(record, nowMs)) continue;
      this.records.delete(key);
    }
  }

  upsert(value: unknown, options: { nowMs?: number; userAgent?: string | null; ownerUserId?: string | null; loginSessionId?: string | null } = {}): WebNotificationPresenceRecord {
    const nowMs = options.nowMs ?? this.now();
    const normalized = normalizeWebNotificationPresence(value, {
      nowMs,
      userAgent: options.userAgent,
      ownerUserId: options.ownerUserId,
      loginSessionId: options.loginSessionId,
    });
    if (!normalized) {
      throw new Error("Invalid web notification presence payload.");
    }
    this.prune(nowMs);
    this.records.set(this.buildKey(normalized.deviceId, normalized.clientId, normalized.ownerUserId, normalized.chatJid), normalized);
    return normalized;
  }

  remove(value: { device_id?: unknown; deviceId?: unknown; client_id?: unknown; clientId?: unknown }, scope?: { ownerUserId: string; loginSessionId: string }): boolean {
    const deviceId = normalizeTrimmedString(value?.device_id ?? value?.deviceId);
    const clientId = normalizeTrimmedString(value?.client_id ?? value?.clientId);
    if (!deviceId || !clientId) return false;
    const chatJid = normalizeTrimmedString((value as { chat_jid?: unknown; chatJid?: unknown })?.chat_jid
      ?? (value as { chat_jid?: unknown; chatJid?: unknown })?.chatJid);
    if (!chatJid) return false;
    const key = this.buildKey(deviceId, clientId, scope?.ownerUserId, chatJid), current = this.records.get(key);
    if (scope && current?.loginSessionId !== scope.loginSessionId) return false;
    return this.records.delete(key);
  }

  getDeviceChatState(deviceId: string, chatJid: string, nowMs = this.now(), scope?: { ownerUserId: string; loginSessionId?: string }): WebNotificationPresenceState {
    const normalizedDeviceId = normalizeTrimmedString(deviceId);
    const normalizedChatJid = normalizeTrimmedString(chatJid);
    if (!normalizedDeviceId || !normalizedChatJid) {
      return { hasLiveClient: false, hasVisibleClient: false, clients: [] };
    }

    this.prune(nowMs);
    const clients = Array.from(this.records.values())
      .filter((record) => record.deviceId === normalizedDeviceId && record.chatJid === normalizedChatJid && this.isLive(record, nowMs)
        && (!scope || (record.ownerUserId === scope.ownerUserId && (scope.loginSessionId === undefined || record.loginSessionId === scope.loginSessionId))))
      .sort((left, right) => left.clientId.localeCompare(right.clientId));

    return {
      hasLiveClient: clients.length > 0,
      hasVisibleClient: clients.some((record) => record.visibilityState === "visible"),
      clients,
    };
  }

  shouldSendWebPush(deviceId: string | null | undefined, chatJid: string | null | undefined, nowMs = this.now(), scope?: { ownerUserId: string; loginSessionId?: string }): boolean {
    const normalizedDeviceId = normalizeTrimmedString(deviceId);
    const normalizedChatJid = normalizeTrimmedString(chatJid);
    if (!normalizedDeviceId || !normalizedChatJid) return true;
    const state = this.getDeviceChatState(normalizedDeviceId, normalizedChatJid, nowMs, scope);
    if (!state.hasLiveClient) return true;
    if (state.hasVisibleClient) return false;

    // iPhone/iPad PWAs can be swiped away without delivering a final teardown beacon.
    // If the only remaining presence records are hidden iOS WebKit clients, prefer Web Push.
    return state.clients.every((record) => isLikelyIosWebKitClient(record.userAgent));
  }

  list(nowMs = this.now()): WebNotificationPresenceRecord[] {
    this.prune(nowMs);
    return Array.from(this.records.values()).sort((left, right) => left.deviceId.localeCompare(right.deviceId) || left.clientId.localeCompare(right.clientId));
  }
}

export const webNotificationPresenceService = new WebNotificationPresenceService();
