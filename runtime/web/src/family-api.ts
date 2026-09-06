/** Family requests are pinned to one authenticated account/login for this page. */
import { ACCOUNT_AVATAR_STORED_BYTES } from '../../src/core/account-avatar.js';
export interface FamilyIdentity {
  userId: string;
  username: string;
  displayName: string;
  loginId: string;
  homeChatJid: string;
  role: "admin" | "member";
  manageUsers: boolean;
}

export function parseFamilyIdentity(value: unknown): FamilyIdentity {
  const principal = (value as any)?.principal;
  if (!principal || principal.kind !== "user" || principal.mode !== "family-shared"
    || !["admin", "member"].includes(principal.role)
    || [principal.userId, principal.username, principal.displayName, principal.authentication?.sessionId, principal.homeChatJid].some(v => typeof v !== "string" || !v.trim())) {
    throw new FamilyRequestError("A family account with an owned home is required.", 409);
  }
  return Object.freeze({ userId: principal.userId, username: principal.username, displayName: principal.displayName,
    loginId: principal.authentication.sessionId, homeChatJid: principal.homeChatJid, role: principal.role,
    manageUsers: principal.role === 'admin' && (value as any)?.capabilities?.manage_users === true });
}

export class FamilyRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function fetchFamilyIdentity(signal?: AbortSignal, headers?: HeadersInit): Promise<FamilyIdentity> {
  const response = await fetch("/auth/me", { cache: "no-store", credentials: "same-origin", signal, headers });
  if (!response.ok) throw new FamilyRequestError("Sign in again to continue.", response.status);
  return parseFamilyIdentity(await response.json());
}

/** Retire old origin caches before requesting any private data. Never run under an old worker. */
export async function prepareFamilyBrowser(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  }
  if ("caches" in window) {
    await Promise.all((await caches.keys()).map(key => caches.delete(key)));
  }
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    throw new Error("The previous service worker has been removed. Close other PiClaw tabs and reload before opening family conversations.");
  }
}

export class FamilyApi {
  private readonly controller = new AbortController();
  constructor(private currentIdentity: FamilyIdentity, private readonly onInvalidated: () => void) {}
  get identity(): FamilyIdentity { return this.currentIdentity; }
  stop(): void { this.controller.abort(); }
  private headers(): Record<string, string> {
    return { "x-piclaw-account-id": this.identity.userId, "x-piclaw-login-id": this.identity.loginId };
  }
  private signal(signal?: AbortSignal): AbortSignal { return AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]); }
  private invalidate(): never {
    this.stop(); this.onInvalidated();
    throw new FamilyRequestError("Your account or login changed. Sign in again.", 409);
  }
  async verifyIdentity(signal?: AbortSignal): Promise<void> {
    if (this.controller.signal.aborted) throw new Error("This page is no longer active.");
    let identity: FamilyIdentity;
    try { identity = await fetchFamilyIdentity(this.signal(signal), this.headers()); }
    catch (error) {
      if (error instanceof FamilyRequestError && [401, 409].includes(error.status)) this.invalidate();
      throw error;
    }
    if (this.controller.signal.aborted) throw new Error("This page is no longer active.");
    if (identity.userId !== this.identity.userId || identity.loginId !== this.identity.loginId) this.invalidate();
    this.currentIdentity = identity;
  }
  private async response(path: string, method: string, body?: unknown, headers?: Record<string, string>, signal?: AbortSignal): Promise<Response> {
    if (this.controller.signal.aborted) throw new Error("This page is no longer active.");
    const response = await fetch(path, { method, cache: "no-store", credentials: "same-origin", signal: this.signal(signal),
      headers: { ...this.headers(), ...(body === undefined ? {} : { "Content-Type": body instanceof Blob ? body.type : "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: body instanceof Blob ? body : JSON.stringify(body) }),
    });
    if (response.status === 401 || response.status === 409) this.invalidate();
    if (!response.ok) throw new FamilyRequestError(response.status === 403 ? "Access denied. Select an owned session or sign in again if fresh authentication is required." : "The request failed. Try again.", response.status);
    return response;
  }
  async request(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<any> {
    const response = await this.response(path, method, body, undefined, signal);
    const value = await response.json();
    // A response admitted under the old cookie must not render after a different login took over.
    await this.verifyIdentity(signal);
    return value;
  }
  async avatarImage(): Promise<Blob> {
    const response = await this.response('/account/avatar/image', 'GET');
    if (response.headers.get('content-type') !== 'image/webp') throw new Error('Invalid avatar response.');
    const blob = await response.blob();
    if (!blob.size || blob.size > ACCOUNT_AVATAR_STORED_BYTES) throw new Error('Invalid avatar response.');
    await this.verifyIdentity();
    return blob;
  }
  async uploadAvatar(file: File, revision: number): Promise<any> {
    const response = await this.response('/account/avatar', 'POST', file, { 'x-piclaw-avatar-revision': String(revision) });
    const value = await response.json();
    await this.verifyIdentity();
    return value;
  }
  async logout(): Promise<void> {
    const response = await fetch("/auth/logout", { method: "POST", cache: "no-store", credentials: "same-origin", signal: this.signal(), headers: this.headers() });
    if (response.status === 401 || response.status === 409) this.invalidate();
    if (!response.ok) throw new FamilyRequestError("Sign out failed. Try again.", response.status);
    this.stop();
  }
}
