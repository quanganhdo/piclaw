export interface PasskeyEntry {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  rpId: string;
  usable: boolean;
  removable: boolean;
}

export interface PasskeyListResponse {
  passkeys: PasskeyEntry[];
  recent_auth: boolean;
  enabled: boolean;
  rp_id: string;
  reauthenticate_url: string;
  unavailable_reason: string | null;
}

export interface PasskeyRegistrationStartResponse {
  token: string;
  options: WebAuthnCreateOptionsJson;
}

export interface WebAuthnCreateOptionsJson {
  rp: PublicKeyCredentialRpEntity;
  pubKeyCredParams: PublicKeyCredentialParameters[];
  challenge: string;
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  excludeCredentials?: Array<{ id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }>;
  [key: string]: unknown;
}

export interface PasskeyErrorSummary {
  message: string;
  signInRequired: boolean;
  recentAuthRequired: boolean;
}

export interface PasskeyCreateSupport {
  supported: boolean;
  secureContext: boolean;
  publicKeyCredential: boolean;
  reason: string | null;
}

export class PasskeyApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "PasskeyApiError";
    this.status = status;
    this.code = code;
  }
}

function normalizeBase64Url(value: string): string {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(normalizeBase64Url(value));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function encodeBase64Url(value: ArrayBuffer): string {
  let raw = "";
  for (const byte of new Uint8Array(value)) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function shortPasskeyId(id: string): string {
  const value = String(id || "");
  if (!value) return "—";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function formatPasskeyTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatPasskeyLastUsed(value: string | null | undefined): string {
  return value ? formatPasskeyTimestamp(value) : "Never used";
}

export function validatePasskeyName(raw: string): { ok: true; value: string } | { ok: false; value: string; error: string } {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, value, error: "Enter a name between 1 and 80 characters." };
  if (Array.from(value).length > 80) return { ok: false, value, error: "Use at most 80 characters." };
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)) return { ok: false, value, error: "Names cannot contain control characters." };
  return { ok: true, value };
}

export function getPasskeyCreateSupport(runtime: Pick<typeof globalThis, "navigator" | "PublicKeyCredential"> & { isSecureContext?: boolean } = globalThis): PasskeyCreateSupport {
  const secureContext = runtime?.isSecureContext === true;
  const publicKeyCredential = typeof runtime?.PublicKeyCredential !== "undefined";
  if (!secureContext) {
    return { supported: false, secureContext, publicKeyCredential, reason: "Passkey creation requires a secure origin." };
  }
  if (!publicKeyCredential || typeof runtime?.navigator?.credentials?.create !== "function") {
    return { supported: false, secureContext, publicKeyCredential, reason: "This browser cannot create passkeys." };
  }
  return { supported: true, secureContext, publicKeyCredential, reason: null };
}

export function getAddPasskeyUnavailableReason(snapshot: PasskeyListResponse | null, runtime: Pick<typeof globalThis, "navigator" | "PublicKeyCredential"> & { isSecureContext?: boolean } = globalThis): string | null {
  const support = getPasskeyCreateSupport(runtime);
  if (!support.supported) return support.reason;
  if (!snapshot) return null;
  if (snapshot.enabled === false) return snapshot.unavailable_reason || "Passkeys are disabled by the login policy.";
  return snapshot.unavailable_reason;
}

async function readJsonBestEffort(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // ignored
  }
  return {};
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers || {}),
    },
  });
  if (response.redirected && new URL(response.url).pathname === '/login') throw new PasskeyApiError(401, 'Sign in required to manage passkeys.');
  const body = await readJsonBestEffort(response);
  if (!response.ok) {
    const message = typeof body.error === "string" && body.error.trim() ? body.error : `Request failed (HTTP ${response.status}).`;
    const code = typeof body.code === "string" && body.code.trim() ? body.code : null;
    throw new PasskeyApiError(response.status, message, code);
  }
  if (init.method === 'POST' && !path.endsWith('/start') && body.ok !== true) throw new Error('The server did not confirm the change. Refresh before retrying.');
  return body as T;
}

export async function fetchPasskeyList(): Promise<PasskeyListResponse> {
  const body = await requestJson<PasskeyListResponse>("/agent/passkeys");
  if (!Array.isArray(body.passkeys) || body.passkeys.some(key => !key || typeof key.id !== 'string' || typeof key.name !== 'string' || typeof key.createdAt !== 'string' || (key.lastUsedAt !== null && typeof key.lastUsedAt !== 'string') || typeof key.rpId !== 'string' || typeof key.usable !== 'boolean' || typeof key.removable !== 'boolean') || typeof body.recent_auth !== 'boolean' || typeof body.enabled !== 'boolean' || typeof body.rp_id !== 'string') throw new Error('Invalid passkey list response. Refresh before making changes.');
  return {
    passkeys: Array.isArray(body.passkeys) ? body.passkeys : [],
    recent_auth: body.recent_auth === true,
    enabled: body.enabled === true,
    rp_id: typeof body.rp_id === "string" ? body.rp_id : "",
    reauthenticate_url: "/login",
    unavailable_reason: typeof body.unavailable_reason === "string" && body.unavailable_reason.trim() ? body.unavailable_reason : null,
  };
}

export async function renamePasskey(id: string, name: string): Promise<void> {
  await requestJson<{ ok: true }>("/agent/passkeys", {
    method: "POST",
    body: JSON.stringify({ action: "rename", id, name }),
  });
}

export async function removePasskey(id: string): Promise<void> {
  await requestJson<{ ok: true }>("/agent/passkeys", {
    method: "POST",
    body: JSON.stringify({ action: "remove", id }),
  });
}

export async function startPasskeyRegistration(name: string, signal?: AbortSignal): Promise<PasskeyRegistrationStartResponse> {
  return requestJson<PasskeyRegistrationStartResponse>("/agent/passkeys/register/start", {
    method: "POST",
    body: JSON.stringify({ name }),
    signal,
  });
}

export async function finishPasskeyRegistration(token: string, credential: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  await requestJson<{ ok: true }>("/agent/passkeys/register/finish", {
    method: "POST",
    body: JSON.stringify({ token, credential }),
    signal,
  });
}

export function createPasskeyCredentialOptions(options: WebAuthnCreateOptionsJson): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: decodeBase64Url(options.challenge),
    user: {
      ...options.user,
      id: decodeBase64Url(options.user.id),
    },
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map((credential) => ({
          ...credential,
          id: decodeBase64Url(String(credential.id || "")),
        }))
      : [],
  } as PublicKeyCredentialCreationOptions;
}

export async function createPasskeyCredential(options: WebAuthnCreateOptionsJson, signal: AbortSignal): Promise<PublicKeyCredential | null> {
  return navigator.credentials.create({
    publicKey: createPasskeyCredentialOptions(options),
    signal,
  }) as Promise<PublicKeyCredential | null>;
}

export function serializePasskeyCredential(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      attestationObject: encodeBase64Url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment,
  };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function isPasskeyCreationCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

export function summarizePasskeyError(error: unknown, fallback = "The request failed. Try again."): PasskeyErrorSummary {
  if (error instanceof PasskeyApiError) {
    if (error.status === 401) {
      return { message: error.message || "Sign in required.", signInRequired: true, recentAuthRequired: false };
    }
    if (error.status === 403 && error.code === "recent_auth_required") {
      return { message: error.message || "Sign in again to continue.", signInRequired: false, recentAuthRequired: true };
    }
    return { message: error.message || fallback, signInRequired: false, recentAuthRequired: false };
  }
  if (error instanceof Error && error.message.trim()) {
    return { message: error.message, signInRequired: false, recentAuthRequired: false };
  }
  return { message: fallback, signInRequired: false, recentAuthRequired: false };
}
