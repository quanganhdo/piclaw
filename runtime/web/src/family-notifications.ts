import type { FamilyApi } from './family-api.js';

export function supportsFamilyWebPush(runtime: Window = window): boolean {
  return runtime.isSecureContext && 'serviceWorker' in runtime.navigator && 'PushManager' in runtime && 'Notification' in runtime;
}

export function decodeApplicationServerKey(value: string): Uint8Array {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

export interface FamilyNotificationState {
  available: boolean;
  enabled: boolean;
  permission: NotificationPermission;
}

export class FamilyNotifications {
  private deviceId = `device-${crypto.randomUUID()}`;
  private readonly clientId = `client-${crypto.randomUUID()}`;
  private timer: ReturnType<typeof setInterval> | undefined;
  private paused = true;
  private stopped = false;
  private enabled = false;
  private presenceChat = '';
  constructor(private readonly api: FamilyApi, private readonly currentChat: () => string) {}
  state(): FamilyNotificationState {
    const available = supportsFamilyWebPush();
    return { available, enabled: available && this.enabled && Notification.permission === 'granted', permission: available ? Notification.permission : 'denied' };
  }
  private async registration(): Promise<ServiceWorkerRegistration> {
    const registration = await navigator.serviceWorker.register('/family-sw.js', { updateViaCache: 'none' });
    return registration;
  }
  private async presence(active: boolean): Promise<void> {
    if (this.stopped || (this.paused && active)) return;
    const chatJid = this.currentChat(); if (!chatJid) return;
    await this.api.request('/agent/push/presence', 'POST', { device_id: this.deviceId, client_id: this.clientId, chat_jid: chatJid,
      visibility_state: document.visibilityState === 'hidden' ? 'hidden' : 'visible', has_focus: document.hasFocus(), active });
    if (active) this.presenceChat = chatJid;
    else if (this.presenceChat === chatJid) this.presenceChat = '';
  }
  private presencePayload(active: boolean, chatJid = this.currentChat()): Record<string, unknown> {
    return { device_id: this.deviceId, client_id: this.clientId, chat_jid: chatJid,
      visibility_state: document.visibilityState === 'hidden' ? 'hidden' : 'visible', has_focus: document.hasFocus(), active };
  }
  async enable(): Promise<void> {
    if (!supportsFamilyWebPush()) throw new Error('Notifications require a supported secure browser.');
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') throw new Error('Notification permission was not granted.');
    const registration = await this.registration(), key = await this.api.request('/agent/push/vapid-public-key');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeApplicationServerKey(key.publicKey) });
    const stored = await this.api.request('/agent/push/subscription', 'POST', { device_id: this.deviceId, subscription: subscription.toJSON() });
    if (typeof stored?.device_id !== 'string' || !stored.device_id.trim()) throw new Error('Invalid notification subscription response.');
    this.deviceId = stored.device_id.trim();
    this.enabled = true;
    await this.presence(true);
  }
  async initialise(): Promise<void> {
    if (!supportsFamilyWebPush() || Notification.permission !== 'granted') return;
    const subscription = await (await this.registration()).pushManager.getSubscription();
    if (!subscription) return;
    const stored = await this.api.request('/agent/push/subscription', 'POST', { device_id: this.deviceId, subscription: subscription.toJSON() });
    if (typeof stored?.device_id !== 'string' || !stored.device_id.trim()) throw new Error('Invalid notification subscription response.');
    this.deviceId = stored.device_id.trim();
    this.enabled = true;
    await this.presence(true);
  }
  async disable(): Promise<void> {
    if (!supportsFamilyWebPush()) return;
    const subscription = await (await this.registration()).pushManager.getSubscription();
    if (subscription) {
      await this.api.request('/agent/push/subscription', 'DELETE', { device_id: this.deviceId, subscription: subscription.toJSON() });
      try { await subscription.unsubscribe(); }
      catch (error) { console.debug('[family-notifications] Browser subscription removal failed after server removal.', error); }
    }
    this.enabled = false;
    await this.presence(false);
  }
  resume(): void {
    if (this.stopped) return;
    const previous = this.presenceChat, current = this.currentChat(); this.paused = false;
    if (this.enabled && previous && previous !== current) this.api.sendNotificationPresence(this.presencePayload(false, previous));
    if (this.enabled) void this.presence(true).catch(error => console.debug('[family-notifications] Presence refresh failed.', error));
    if (this.enabled && !this.timer) this.timer = setInterval(() => { void this.presence(true).catch(error => console.debug('[family-notifications] Presence refresh failed.', error)); }, 15_000);
  }
  suspend(): void {
    if (this.paused) return;
    this.paused = true; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    if (this.enabled) this.api.sendNotificationPresence(this.presencePayload(false));
  }
  stop(): void {
    const chatJid = this.presenceChat || this.currentChat();
    if (this.enabled && chatJid) this.api.sendNotificationPresence(this.presencePayload(false, chatJid));
    if (this.timer) clearInterval(this.timer); this.timer = undefined; this.paused = true; this.stopped = true;
  }
}
