import "../helpers.js";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PushoverChannel } from "../../src/channels/pushover.js";
import type { WebChannelLike } from "../../src/channels/web/core/web-channel-contracts.js";
import { WebNotificationPresenceService } from "../../src/channels/web/push/web-notification-presence-service.js";
import { sendStoredWebPushNotification, type WebPushNotificationPayload } from "../../src/channels/web/push/web-push-service.js";
import { upsertStoredWebPushSubscription } from "../../src/channels/web/push/web-push-store.js";
import { broadcastEvent, type SseClientContainer } from "../../src/channels/web/sse/sse.js";
import type { DeliveryBoundary, DeliveryBoundaryAttempt, DeliveryDriverError, DeliveryKind } from "../../src/service-effects/contracts/delivery-driver.js";
import { createChannelDeliveryBoundary, createPushoverBoundary, createTimelineBroadcastBoundary, createWakeBoundary, createWebPushBoundary, type ChannelSendCallback, type WakeCallback } from "../../src/service-effects/current-piclaw/delivery-boundaries.js";
import { CurrentPiclawDeliveryDriver } from "../../src/service-effects/current-piclaw/delivery-driver.js";
import { TestingCurrentPiclawAdapterRuntime } from "../../src/service-effects/testing/current-piclaw-adapter-runtime.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { InMemoryEffectPayloadResolver } from "../../src/service-effects/testing/in-memory-payload-resolver.js";

const clock = new ManualEffectClock("2026-08-12T00:00:00.000Z");
const tempDirs: string[] = [];
afterEach(() => { while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true }); });
const input = (bytes = new TextEncoder().encode("hello")): DeliveryBoundaryAttempt => ({ request: { outboxId: "o", idempotencyKey: "k", payloadRef: "p", destinationRef: "web:chat", deliveryIdentity: "identity-1", attempt: 1, signal: new AbortController().signal }, payload: { ref: "p", sha256: "a".repeat(64), byteLength: bytes.byteLength, mediaType: "text/plain", redactionClass: "private", bytes } });

describe("current Piclaw delivery boundary factories", () => {
  test("real SSE broadcastEvent synchronously preserves event, data, and chat scope", async () => {
    const webFrames: Uint8Array[] = []; const otherFrames: Uint8Array[] = [];
    const container: SseClientContainer = { clients: new Set([
      { chatJid: "web:chat", heartbeat: setInterval(() => {}, 60_000), controller: { enqueue(value: Uint8Array) { webFrames.push(value); } } as ReadableStreamDefaultController<Uint8Array> },
      { chatJid: "web:other", heartbeat: setInterval(() => {}, 60_000), controller: { enqueue(value: Uint8Array) { otherFrames.push(value); } } as ReadableStreamDefaultController<Uint8Array> },
    ]) };
    try {
      const callback = ((eventType, data) => broadcastEvent(container, eventType, data)) satisfies (eventType: string, data: unknown) => void;
      const boundary = createTimelineBroadcastBoundary(clock, callback, "agent_status", ({ request }) => ({ chat_jid: request.destinationRef!, delivery_id: request.deliveryIdentity, value: "ready" }));
      expect((await boundary.attempt(input())).detail).toEqual({ kind: "timeline_broadcast", providerMessageId: null, eventId: "identity-1" });
      expect(new TextDecoder().decode(webFrames[0])).toBe('event: agent_status\ndata: {"chat_jid":"web:chat","delivery_id":"identity-1","value":"ready"}\n\n'); expect(otherFrames).toEqual([]);
    } finally { for (const client of container.clients) clearInterval(client.heartbeat); }
  });

  test("channel and wake callbacks satisfy current signatures and forward arguments", async () => {
    const sent: unknown[] = []; const channelMethod: Pick<WebChannelLike, "sendMessage">["sendMessage"] = async (...args) => { sent.push(args); };
    const send = channelMethod satisfies ChannelSendCallback; await createChannelDeliveryBoundary(clock, send).attempt(input()); expect(sent).toEqual([["web:chat", "hello"]]);
    const wakes: string[] = []; const currentResume: (chatJid: string, threadRootId?: number | null) => void = (jid) => { wakes.push(jid); };
    const wake = currentResume satisfies WakeCallback; const result = await createWakeBoundary(clock, wake).attempt(input()); expect(wakes).toEqual(["web:chat"]); expect(result.detail).toEqual({ kind: "wake_chat", providerMessageId: null, wakeId: "identity-1" });
  });

  test("timeline mapper throw/missing/mismatched identities are bounded before broadcast", async () => {
    let calls = 0;
    const invalid = [
      () => { throw new Error("mapper"); },
      () => ({ chat_jid: "web:chat", delivery_id: "" }),
      () => ({ chat_jid: "web:other", delivery_id: "identity-1" }),
      () => ({ chat_jid: "web:chat", delivery_id: "identity-other" }),
      () => throwingMappedValue("chat_jid", "web:chat", { delivery_id: "identity-1" }),
      () => throwingMappedValue("delivery_id", "identity-1", { chat_jid: "web:chat" }),
      () => changingMappedValue("chat_jid", "web:chat", { delivery_id: "identity-1" }),
      () => changingMappedValue("delivery_id", "identity-1", { chat_jid: "web:chat" }),
    ];
    for (const mapper of invalid) {
      const boundary = createTimelineBroadcastBoundary(clock, () => { calls += 1; }, "agent_status", mapper);
      const error = await captureError(() => boundary.attempt(input())); expect(boundary.classifyError?.(error)).toEqual({ _tag: "invalid_payload", certainty: "not_applied", retryable: false });
    }
    expect(calls).toBe(0);
  });

  test("real stored Web Push service preserves partial aggregate counts without network", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "piclaw-delivery-boundary-")); tempDirs.push(baseDir);
    for (const id of [1, 2, 3]) upsertStoredWebPushSubscription({ endpoint: `https://push.example.test/${id}`, expirationTime: null, keys: { auth: `auth-${id}`, p256dh: `key-${id}` } }, { baseDir, deviceId: `device-${id}` });
    const presence = new WebNotificationPresenceService(); const send = ((payload: WebPushNotificationPayload) => sendStoredWebPushNotification(payload, { baseDir, presenceService: presence, sendNotification: async (subscription) => { if (subscription.endpoint.endsWith("/1")) throw { statusCode: 410 }; if (subscription.endpoint.endsWith("/2")) throw new Error("temporary"); } })) satisfies (payload: WebPushNotificationPayload) => Promise<import("../../src/channels/web/push/web-push-service.js").StoredWebPushSendResult>;
    const result = await createWebPushBoundary(clock, send, () => ({ title: "Public", body: "Body" })).attempt(input());
    expect(result.detail).toEqual({ kind: "web_push", providerMessageId: null, counts: { attempted: 3, sent: 1, removed: 1, failed: 1 } });
  });

  test("real PushoverChannel truncates to 1024 with stub fetch and returns no receipt", async () => {
    const previousFetch = globalThis.fetch; const bodies: Record<string, string>[] = [];
    globalThis.fetch = (async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response("ok", { status: 200 }); }) as typeof fetch;
    try {
      const channel = new PushoverChannel({ appToken: "app", userKey: "user" }); const text = "x".repeat(1100); const bytes = new TextEncoder().encode(text);
      const result = await createPushoverBoundary(clock, channel.sendMessage.bind(channel)).attempt(input(bytes));
      expect(bodies[0]?.message).toHaveLength(1024); expect(bodies[0]?.message.endsWith("...")).toBe(true); expect(result.detail).toEqual({ kind: "pushover", providerMessageId: null });
    } finally { globalThis.fetch = previousFetch; }
  });

  test("Pushover HTTP/generic throws stay unknown unless a typed classifier proves rejection", async () => {
    const classified: DeliveryDriverError = { _tag: "rejected", certainty: "not_applied", retryable: false };
    const generic = createPushoverBoundary(clock, async () => { throw new Error("transport"); }); expect(generic.classifyError?.(new Error("transport"))).toBeNull();
    const typed = createPushoverBoundary(clock, async () => { throw new Error("HTTP 400"); }, () => classified); expect(typed.classifyError?.(new Error("HTTP 400"))).toEqual(classified);
  });

  test("payload mappers and fatal UTF-8 failures classify pre-effect invalid_payload", async () => {
    let calls = 0; const text = createChannelDeliveryBoundary(clock, async () => { calls += 1; }); const invalidBytes = new Uint8Array([0xc3, 0x28]);
    await expect(text.attempt(input(invalidBytes))).rejects.toThrow(); expect(text.classifyError?.(await captureError(() => text.attempt(input(invalidBytes))))?._tag).toBe("invalid_payload"); expect(calls).toBe(0);
    const hostilePushMappers = ["title", "body", "url", "tag", "sourceLabel"].flatMap((field) => [
      () => throwingMappedValue(field, field === "title" ? "title" : field === "body" ? "body" : undefined, { title: "title", body: "body" }),
      () => changingMappedValue(field, field === "title" ? "title" : field === "body" ? "body" : undefined, { title: "title", body: "body" }),
    ]);
    for (const mapper of [() => { throw new Error("mapper"); }, () => ({ title: 1, body: "body" }), () => ({ title: "title", body: 2 }), () => ({ title: "title", body: "body", url: 3 }), ...hostilePushMappers]) {
      const push = createWebPushBoundary(clock, async () => { calls += 1; return { attempted: 0, sent: 0, removed: 0, failed: 0 }; }, mapper as never);
      expect(push.classifyError?.(await captureError(() => push.attempt(input())))?._tag).toBe("invalid_payload");
    }
    expect(calls).toBe(0);
  });

  test("all current provider factories compose through the current driver with derived certainty", async () => {
    const callbacks = { timeline: 0, channel: 0, wake: 0, push: 0, pushover: 0 };
    const timeline = driverFor("timeline_broadcast", createTimelineBroadcastBoundary(clock, () => { callbacks.timeline += 1; }, "agent_status", ({ request }) => ({ chat_jid: request.destinationRef!, delivery_id: request.deliveryIdentity })));
    const channel = driverFor("channel_delivery", createChannelDeliveryBoundary(clock, async (jid) => { callbacks.channel += 1; expect(jid).toBe("web:chat"); }));
    const wake = driverFor("wake_chat", createWakeBoundary(clock, (jid) => { callbacks.wake += 1; expect(jid).toBe("web:chat"); }));
    for (const driver of [timeline, channel, wake]) { const result = await driver.deliver({ ...input().request, destinationRef: "  web:chat  " }); expect(result.ok && result.value.certainty).toBe("applied"); expect(driver.reconcile).toBeUndefined(); }

    const baseDir = mkdtempSync(join(tmpdir(), "piclaw-composed-push-")); tempDirs.push(baseDir);
    for (const id of [11, 12]) upsertStoredWebPushSubscription({ endpoint: `https://push.example.test/composed/${id}`, expirationTime: null, keys: { auth: `auth-${id}`, p256dh: `key-${id}` } }, { baseDir });
    const webPush = driverFor("web_push", createWebPushBoundary(clock, (payload) => sendStoredWebPushNotification(payload, { baseDir, presenceService: new WebNotificationPresenceService(), sendNotification: async (subscription) => { callbacks.push += 1; if (subscription.endpoint.endsWith("/11")) throw new Error("partial"); } }), () => ({ title: "Title", body: "Body" })));
    const pushResult = await webPush.deliver(input().request); expect(pushResult.ok && pushResult.value.certainty).toBe("unknown"); expect(callbacks.push).toBe(2); expect(webPush.reconcile).toBeUndefined();

    const previousFetch = globalThis.fetch; globalThis.fetch = (async () => { callbacks.pushover += 1; return new Response("ok", { status: 200 }); }) as typeof fetch;
    try {
      const pushoverChannel = new PushoverChannel({ appToken: "app", userKey: "user" }); const pushover = driverFor("pushover", createPushoverBoundary(clock, pushoverChannel.sendMessage.bind(pushoverChannel)));
      const success = await pushover.deliver(input().request); expect(success.ok && success.value.certainty).toBe("applied"); expect(success.ok && success.value.receiptRef).toBeNull(); expect(callbacks.pushover).toBe(1); expect(pushover.reconcile).toBeUndefined();
    } finally { globalThis.fetch = previousFetch; }
    const generic = driverFor("pushover", createPushoverBoundary(clock, async () => { throw new Error("transport"); })); const genericResult = await generic.deliver(input().request); expect(!genericResult.ok && genericResult.error.certainty).toBe("unknown");
    const typed = driverFor("pushover", createPushoverBoundary(clock, async () => { throw new Error("rejected"); }, () => ({ _tag: "rejected", certainty: "not_applied", retryable: false }))); const typedResult = await typed.deliver(input().request); expect(!typedResult.ok && typedResult.error._tag).toBe("rejected"); expect(!typedResult.ok && typedResult.error.certainty).toBe("not_applied");
    expect(callbacks).toEqual({ timeline: 1, channel: 1, wake: 1, push: 2, pushover: 1 });
  });

  test("driver maps fatal decode before callback to bounded invalid_payload", async () => {
    const payloads = new InMemoryEffectPayloadResolver(); payloads.putBytes("p", new Uint8Array([0xc3, 0x28]), "text/plain");
    const boundary = createChannelDeliveryBoundary(clock, async () => { throw new Error("must not run"); }); const runtime = new TestingCurrentPiclawAdapterRuntime({ clock, ids: new SequenceEffectIdSource("boundary"), faults: new DeterministicFaultPlan() });
    const driver = new CurrentPiclawDeliveryDriver("channel_delivery", payloads, () => true, boundary, runtime); const result = await driver.deliver(input().request); expect(result.ok).toBe(false); if (!result.ok) expect(result.error).toEqual({ _tag: "invalid_payload", certainty: "not_applied", retryable: false });
  });
});

function throwingMappedValue(field: string, value: unknown, other: Record<string, unknown>): Record<string, unknown> { return Object.defineProperty({ ...other }, field, { enumerable: true, get() { throw new Error(`throwing ${field}`); } }); }
function changingMappedValue(field: string, value: unknown, other: Record<string, unknown>): Record<string, unknown> { let reads = 0; return Object.defineProperty({ ...other }, field, { enumerable: true, get() { reads += 1; return reads === 1 ? value : (() => { throw new Error(`changing ${field}`); })(); } }); }
function driverFor(kind: DeliveryKind, boundary: DeliveryBoundary): CurrentPiclawDeliveryDriver {
  const payloads = new InMemoryEffectPayloadResolver(); payloads.putText("p", "hello");
  const runtime = new TestingCurrentPiclawAdapterRuntime({ clock, ids: new SequenceEffectIdSource(`driver-${kind}`), faults: new DeterministicFaultPlan() });
  return new CurrentPiclawDeliveryDriver(kind, payloads, () => true, boundary, runtime);
}
async function captureError(run: () => Promise<unknown>): Promise<unknown> { try { await run(); return null; } catch (error) { return error; } }
