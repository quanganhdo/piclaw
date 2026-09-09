/**
 * web/push/web-push-store.ts – Minimal persistent storage for VAPID keys and Web Push subscriptions.
 */

import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { WORKSPACE_DIR, getWebRuntimeConfig } from "../../../core/config.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.push.store");
const DEFAULT_PUSH_DIR = resolve(WORKSPACE_DIR, ".piclaw", "web-push");
const VAPID_FILE_NAME = "vapid-keys.json";
const SUBSCRIPTIONS_FILE_NAME = "subscriptions.json";

export interface StoredWebPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
  createdAt: string;
  updatedAt: string;
  userAgent: string | null;
  deviceId: string | null;
  ownerUserId: string | null;
  loginSessionId: string | null;
}

export interface WebPushSubscriptionScope {
  ownerUserId: string;
  loginSessionId?: string;
  deviceId?: string;
}

const FAMILY_SUBSCRIPTION_CAP_PER_OWNER = 8;
const mutationTails = new Map<string, Promise<void>>();

function serialiseMutation<T>(baseDir: string, mutate: () => T): Promise<T> {
  const key = resolvePushDir(baseDir), previous = mutationTails.get(key) ?? Promise.resolve();
  const run = previous.then(mutate);
  const tail = run.then(() => undefined, () => undefined);
  mutationTails.set(key, tail);
  void tail.finally(() => { if (mutationTails.get(key) === tail) mutationTails.delete(key); });
  return run;
}

export interface StoredVapidKeys {
  createdAt: string;
  publicKey: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

function resolvePushDir(baseDir = DEFAULT_PUSH_DIR): string {
  return resolve(baseDir);
}

function resolveVapidKeysPath(baseDir = DEFAULT_PUSH_DIR): string {
  return resolve(resolvePushDir(baseDir), VAPID_FILE_NAME);
}

function resolveSubscriptionsPath(baseDir = DEFAULT_PUSH_DIR): string {
  return resolve(resolvePushDir(baseDir), SUBSCRIPTIONS_FILE_NAME);
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (error) {
    debugSuppressedError(log, "Failed to read stored web push state; ignoring the stale file.", error, { path });
    return null;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(path), 0o700);
  } catch (error) {
    debugSuppressedError(log, "Failed to tighten web push store directory permissions; continuing with existing mode.", error, {
      dir: dirname(path),
    });
  }
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function encodeBase64Url(value: Buffer | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function createVapidKeys(): StoredVapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });

  const publicJwk = createPublicKey(publicKey).export({ format: "jwk" }) as JsonWebKey;
  const x = typeof publicJwk.x === "string" ? publicJwk.x : "";
  const y = typeof publicJwk.y === "string" ? publicJwk.y : "";
  if (!x || !y) {
    throw new Error("Generated VAPID key is missing JWK coordinates.");
  }

  const publicPoint = Buffer.concat([
    Buffer.from([0x04]),
    decodeBase64Url(x),
    decodeBase64Url(y),
  ]);

  return {
    createdAt: new Date().toISOString(),
    publicKey: encodeBase64Url(publicPoint),
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

function readStoredVapidKeys(baseDir = DEFAULT_PUSH_DIR): StoredVapidKeys | null {
  const path = resolveVapidKeysPath(baseDir);
  const parsed = readJsonFile<StoredVapidKeys>(path);
  if (!parsed) return null;
  if (!parsed.publicKey || !parsed.publicKeyPem || !parsed.privateKeyPem) return null;
  return parsed;
}

export function ensureStoredVapidKeys(baseDir = DEFAULT_PUSH_DIR): StoredVapidKeys {
  const existing = readStoredVapidKeys(baseDir);
  if (existing) return existing;
  const created = createVapidKeys();
  writeJsonFile(resolveVapidKeysPath(baseDir), created);
  return created;
}

export function getStoredVapidPublicKey(baseDir = DEFAULT_PUSH_DIR): string {
  return ensureStoredVapidKeys(baseDir).publicKey;
}

export function normalizeStoredWebPushSubscription(
  value: unknown,
  options: { now?: string; userAgent?: string | null; deviceId?: string | null; ownerUserId?: string | null; loginSessionId?: string | null } = {}
): StoredWebPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, any>;
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  const p256dh = typeof input.keys?.p256dh === "string" ? input.keys.p256dh.trim() : "";
  const auth = typeof input.keys?.auth === "string" ? input.keys.auth.trim() : "";
  if (!endpoint || !endpoint.startsWith("https://") || !p256dh || !auth) return null;

  const now = options.now || new Date().toISOString();
  const rawExpirationTime = input.expirationTime;
  const expirationTime = rawExpirationTime === null || rawExpirationTime === undefined
    ? null
    : Number(rawExpirationTime);
  const ownerUserId = normalizeScopeValue(options.ownerUserId);
  const loginSessionId = normalizeScopeValue(options.loginSessionId);
  if (Boolean(ownerUserId) !== Boolean(loginSessionId)
    || ((options.ownerUserId !== undefined || options.loginSessionId !== undefined) && (!ownerUserId || !loginSessionId))) return null;
  const deviceId = typeof options.deviceId === "string" && options.deviceId.trim()
    ? options.deviceId.trim()
    : (typeof input.deviceId === "string" && input.deviceId.trim() ? input.deviceId.trim() : null);
  const userAgent = typeof options.userAgent === "string" && options.userAgent.trim() ? options.userAgent.trim() : null;
  if (endpoint.length > 4096 || p256dh.length > 1024 || auth.length > 1024 || (deviceId?.length ?? 0) > 256 || (userAgent?.length ?? 0) > 512) return null;
  return {
    endpoint,
    expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
    keys: { auth, p256dh },
    createdAt: now,
    updatedAt: now,
    userAgent,
    deviceId,
    ownerUserId,
    loginSessionId,
  };
}

function normalizeScopeValue(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 256) return null;
  for (const character of normalized) {
    const code = character.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f) return null;
  }
  return normalized;
}

export function listStoredWebPushSubscriptions(baseDir = DEFAULT_PUSH_DIR, scope?: WebPushSubscriptionScope): StoredWebPushSubscription[] {
  const path = resolveSubscriptionsPath(baseDir);
  const parsed = readJsonFile<StoredWebPushSubscription[]>(path);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const updatedAt = typeof entry?.updatedAt === "string" && entry.updatedAt.trim() ? entry.updatedAt : new Date().toISOString();
    const normalized = normalizeStoredWebPushSubscription(entry, {
      now: updatedAt,
      userAgent: typeof entry?.userAgent === "string" ? entry.userAgent : null,
      deviceId: typeof entry?.deviceId === "string" ? entry.deviceId : null,
      ...(typeof entry?.ownerUserId === "string" ? { ownerUserId: entry.ownerUserId } : {}),
      ...(typeof entry?.loginSessionId === "string" ? { loginSessionId: entry.loginSessionId } : {}),
    });
    if (!normalized) return [];
    normalized.createdAt = typeof entry?.createdAt === "string" && entry.createdAt.trim() ? entry.createdAt : normalized.createdAt;
    if (scope && (normalized.ownerUserId !== scope.ownerUserId
      || (scope.loginSessionId !== undefined && normalized.loginSessionId !== scope.loginSessionId)
      || (scope.deviceId !== undefined && normalized.deviceId !== scope.deviceId))) return [];
    return [normalized];
  });
}

function writeStoredWebPushSubscriptions(entries: StoredWebPushSubscription[], baseDir = DEFAULT_PUSH_DIR): void {
  writeJsonFile(resolveSubscriptionsPath(baseDir), entries);
}

function getMaxStoredWebPushSubscriptions(): number {
  const configuredCap = Number(getWebRuntimeConfig().pushSubscriptionCap);
  return Math.max(1, Number.isFinite(configuredCap) ? Math.trunc(configuredCap) : 32);
}

function capStoredWebPushSubscriptions(entries: StoredWebPushSubscription[]): StoredWebPushSubscription[] {
  const maxEntries = getMaxStoredWebPushSubscriptions();
  if (entries.length <= maxEntries) return entries;
  return entries
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "") || 0;
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "") || 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.endpoint.localeCompare(right.endpoint);
    })
    .slice(0, maxEntries);
}

function upsertStoredWebPushSubscriptionSync(
  value: unknown,
  options: { baseDir?: string; userAgent?: string | null; now?: string; deviceId?: string | null; ownerUserId?: string | null; loginSessionId?: string | null; allowOwnerRebind?: boolean } = {}
): StoredWebPushSubscription {
  const normalized = normalizeStoredWebPushSubscription(value, {
    now: options.now,
    userAgent: options.userAgent,
    deviceId: options.deviceId,
    ownerUserId: options.ownerUserId,
    loginSessionId: options.loginSessionId,
  });
  if (!normalized) {
    throw new Error("Invalid push subscription.");
  }

  const baseDir = options.baseDir || DEFAULT_PUSH_DIR;
  const entries = listStoredWebPushSubscriptions(baseDir);
  const endpointIndex = entries.findIndex((entry) => entry.endpoint === normalized.endpoint);
  if (endpointIndex !== -1 && entries[endpointIndex]!.ownerUserId !== normalized.ownerUserId
    && (!options.allowOwnerRebind || entries[endpointIndex]!.keys.auth !== normalized.keys.auth || entries[endpointIndex]!.keys.p256dh !== normalized.keys.p256dh)) {
    throw new Error("Invalid push subscription.");
  }
  const deviceIndex = normalized.deviceId ? entries.findIndex((entry) => entry.deviceId === normalized.deviceId
    && entry.ownerUserId === normalized.ownerUserId) : -1;
  const existingIndex = endpointIndex !== -1 ? endpointIndex : deviceIndex;
  if (existingIndex !== -1) {
    const existing = entries[existingIndex];
    const nextEntry = {
      ...existing,
      endpoint: normalized.endpoint,
      expirationTime: normalized.expirationTime,
      keys: normalized.keys,
      updatedAt: normalized.updatedAt,
      userAgent: normalized.userAgent || existing.userAgent || null,
      deviceId: endpointIndex !== -1 ? (existing.deviceId || normalized.deviceId || null) : (normalized.deviceId || existing.deviceId || null),
      ownerUserId: normalized.ownerUserId,
      loginSessionId: normalized.loginSessionId,
      createdAt: existing.ownerUserId === normalized.ownerUserId ? existing.createdAt : normalized.createdAt,
    };
    entries[existingIndex] = nextEntry;
    writeStoredWebPushSubscriptions(capStoredWebPushSubscriptionsByOwner(entries, normalized.ownerUserId), baseDir);
    return nextEntry;
  }

  entries.push(normalized);
  writeStoredWebPushSubscriptions(capStoredWebPushSubscriptionsByOwner(entries, normalized.ownerUserId), baseDir);
  return normalized;
}

/** Serialize read-modify-write updates so concurrent tabs cannot drop another account's record. */
export function upsertStoredWebPushSubscriptionAtomic(
  value: unknown,
  options: Parameters<typeof upsertStoredWebPushSubscriptionSync>[1] & { validate?: () => void } = {},
): Promise<StoredWebPushSubscription> {
  return serialiseMutation(options.baseDir || DEFAULT_PUSH_DIR, () => { options.validate?.(); return upsertStoredWebPushSubscriptionSync(value, options); });
}

export const upsertStoredWebPushSubscription = upsertStoredWebPushSubscriptionSync;

function capStoredWebPushSubscriptionsByOwner(entries: StoredWebPushSubscription[], ownerUserId: string | null): StoredWebPushSubscription[] {
  if (ownerUserId === null) return capStoredWebPushSubscriptions(entries);
  const sameOwner = entries.filter(entry => entry.ownerUserId === ownerUserId).sort((left, right) => {
    const difference = (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
    return difference || left.endpoint.localeCompare(right.endpoint);
  }).slice(0, FAMILY_SUBSCRIPTION_CAP_PER_OWNER);
  return capStoredWebPushSubscriptions([...entries.filter(entry => entry.ownerUserId !== ownerUserId), ...sameOwner]);
}

function removeStoredWebPushSubscriptionSync(endpoint: string, baseDir = DEFAULT_PUSH_DIR, scope?: WebPushSubscriptionScope): boolean {
  const normalizedEndpoint = typeof endpoint === "string" ? endpoint.trim() : "";
  if (!normalizedEndpoint) return false;
  const entries = listStoredWebPushSubscriptions(baseDir);
  const nextEntries = entries.filter((entry) => entry.endpoint !== normalizedEndpoint || (scope !== undefined
    && (entry.ownerUserId !== scope.ownerUserId || (scope.loginSessionId !== undefined && entry.loginSessionId !== scope.loginSessionId)
      || (scope.deviceId !== undefined && entry.deviceId !== scope.deviceId))));
  if (nextEntries.length === entries.length) return false;
  writeStoredWebPushSubscriptions(nextEntries, baseDir);
  return true;
}

export function removeStoredWebPushSubscriptionAtomic(endpoint: string, baseDir = DEFAULT_PUSH_DIR, scope?: WebPushSubscriptionScope, validate?: () => void): Promise<boolean> {
  return serialiseMutation(baseDir, () => { validate?.(); return removeStoredWebPushSubscriptionSync(endpoint, baseDir, scope); });
}

export const removeStoredWebPushSubscription = removeStoredWebPushSubscriptionSync;

export function pruneStoredWebPushSubscriptions(predicate: (subscription: StoredWebPushSubscription) => boolean, baseDir = DEFAULT_PUSH_DIR): Promise<number> {
  return serialiseMutation(baseDir, () => {
    const entries = listStoredWebPushSubscriptions(baseDir), nextEntries = entries.filter(entry => !predicate(entry));
    if (nextEntries.length !== entries.length) writeStoredWebPushSubscriptions(nextEntries, baseDir);
    return entries.length - nextEntries.length;
  });
}
