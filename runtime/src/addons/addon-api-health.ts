import { getAddonsConfig } from "../core/config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("addons.api-health");

export type AddonConfigApiTransport = "direct_handler" | "legacy_slash_command";

export interface AddonApiHealthEntry {
  addonId: string;
  action: string;
  chatJid: string | null;
  method: string;
  path: string;
  transport: AddonConfigApiTransport;
  degraded: boolean;
  failureCount: number;
  firstFailedAt: string | null;
  lastFailedAt: string | null;
  lastRecoveredAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  suppressedUntil: string | null;
  suppressedCount: number;
}

const MAX_ENTRIES = 200;
const entries = new Map<string, AddonApiHealthEntry>();
const transportCounts: Record<AddonConfigApiTransport, number> = {
  direct_handler: 0,
  legacy_slash_command: 0,
};

function nowIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

function backoffMs(): number {
  return getAddonsConfig().apiFailureBackoffMs;
}

function keyFor(input: { addonId: string; action: string; chatJid?: string | null; method?: string; path?: string }): string {
  return [
    String(input.addonId || "").trim(),
    String(input.action || "").trim(),
    String(input.chatJid || "").trim(),
    String(input.method || "").trim().toUpperCase(),
    String(input.path || "").trim(),
  ].join("::");
}

function pruneIfNeeded(): void {
  if (entries.size <= MAX_ENTRIES) return;
  const victims = [...entries.entries()]
    .sort((a, b) => String(a[1].lastFailedAt || a[1].lastRecoveredAt || "").localeCompare(String(b[1].lastFailedAt || b[1].lastRecoveredAt || "")))
    .slice(0, entries.size - MAX_ENTRIES);
  for (const [key] of victims) entries.delete(key);
}

export function recordAddonApiTransportSelection(input: {
  addonId: string;
  action: string;
  chatJid?: string | null;
  method?: string;
  path?: string;
  transport: AddonConfigApiTransport;
}): void {
  transportCounts[input.transport] += 1;
  log.info("Selected add-on config API transport", {
    operation: "addon_api.transport_selected",
    addonId: String(input.addonId || "").trim(),
    action: String(input.action || "").trim(),
    chatJid: input.chatJid ? String(input.chatJid).trim() : null,
    method: String(input.method || "").trim().toUpperCase() || "GET",
    path: String(input.path || "").trim(),
    transport: input.transport,
  });
}

export function recordAddonApiFailure(input: {
  addonId: string;
  action: string;
  chatJid?: string | null;
  method?: string;
  path?: string;
  transport: AddonConfigApiTransport;
  status?: number | null;
  error?: unknown;
}): AddonApiHealthEntry & { shouldLog: boolean } {
  const nowMs = Date.now();
  const key = keyFor(input);
  const previous = entries.get(key);
  const suppressedUntilMs = previous?.suppressedUntil ? Date.parse(previous.suppressedUntil) : 0;
  const shouldLog = !previous || !Number.isFinite(suppressedUntilMs) || nowMs >= suppressedUntilMs;
  const next: AddonApiHealthEntry = {
    addonId: String(input.addonId || "").trim(),
    action: String(input.action || "").trim(),
    chatJid: input.chatJid ? String(input.chatJid).trim() : null,
    method: String(input.method || "").trim().toUpperCase() || "GET",
    path: String(input.path || "").trim(),
    transport: input.transport,
    degraded: true,
    failureCount: (previous?.failureCount ?? 0) + 1,
    firstFailedAt: previous?.firstFailedAt ?? nowIso(nowMs),
    lastFailedAt: nowIso(nowMs),
    lastRecoveredAt: previous?.lastRecoveredAt ?? null,
    lastStatus: Number.isFinite(input.status) ? Number(input.status) : null,
    lastError: String((input.error as Error)?.message || input.error || "Addon API request failed"),
    suppressedUntil: nowIso(nowMs + backoffMs()),
    suppressedCount: previous ? previous.suppressedCount + (shouldLog ? 0 : 1) : 0,
  };
  entries.set(key, next);
  pruneIfNeeded();
  if (shouldLog) {
    log.warn("Add-on API request failed; repeated identical failures will be suppressed temporarily", {
      operation: "addon_api.failure",
      addonId: next.addonId,
      action: next.action,
      chatJid: next.chatJid,
      method: next.method,
      path: next.path,
      transport: next.transport,
      status: next.lastStatus,
      error: next.lastError,
      failureCount: next.failureCount,
      suppressedUntil: next.suppressedUntil,
    });
  }
  return { ...next, shouldLog };
}

export function recordAddonApiSuccess(input: {
  addonId: string;
  action: string;
  chatJid?: string | null;
  method?: string;
  path?: string;
  transport: AddonConfigApiTransport;
}): AddonApiHealthEntry | null {
  const key = keyFor(input);
  const previous = entries.get(key);
  if (!previous) return null;
  const next: AddonApiHealthEntry = {
    ...previous,
    transport: input.transport,
    degraded: false,
    lastRecoveredAt: nowIso(),
    lastStatus: 200,
    lastError: null,
    suppressedUntil: null,
    suppressedCount: 0,
  };
  entries.set(key, next);
  log.info("Add-on API request recovered", {
    operation: "addon_api.recovered",
    addonId: next.addonId,
    action: next.action,
    chatJid: next.chatJid,
    method: next.method,
    path: next.path,
    transport: next.transport,
    failureCount: next.failureCount,
  });
  return next;
}

export function getAddonApiHealthSnapshot(): {
  degraded: boolean;
  entries: AddonApiHealthEntry[];
  transportCounts: Record<AddonConfigApiTransport, number>;
} {
  const snapshot = [...entries.values()].filter((entry) => entry.degraded);
  return { degraded: snapshot.length > 0, entries: snapshot, transportCounts: { ...transportCounts } };
}

export function resetAddonApiHealthForTests(): void {
  entries.clear();
  transportCounts.direct_handler = 0;
  transportCounts.legacy_slash_command = 0;
}
