import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { WEB_RUNTIME_CONFIG } from "../../../src/core/config.js";
import {
  ensureStoredVapidKeys,
  getStoredVapidPublicKey,
  listStoredWebPushSubscriptions,
  normalizeStoredWebPushSubscription,
  removeStoredWebPushSubscription,
  pruneStoredWebPushSubscriptions,
  upsertStoredWebPushSubscription,
  upsertStoredWebPushSubscriptionAtomic,
} from "../../../src/channels/web/push/web-push-store.js";

const tempDirs: string[] = [];

function createTempPushDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-web-push-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createSubscription(endpoint = "https://push.example.test/device/1", deviceId: string | null = null) {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      auth: "auth-token",
      p256dh: "p256dh-token",
    },
    ...(deviceId ? { deviceId } : {}),
  };
}

describe("web push store", () => {
  test("generates and reuses a stored VAPID keypair", () => {
    const baseDir = createTempPushDir();

    const created = ensureStoredVapidKeys(baseDir);
    const reread = ensureStoredVapidKeys(baseDir);

    expect(created.publicKey).toBeTruthy();
    expect(created.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(created.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(reread.publicKey).toBe(created.publicKey);
    expect(getStoredVapidPublicKey(baseDir)).toBe(created.publicKey);
  });

  test("normalizes valid subscriptions and rejects malformed ones", () => {
    const normalized = normalizeStoredWebPushSubscription(createSubscription());

    expect(normalized?.endpoint).toBe("https://push.example.test/device/1");
    expect(normalized?.expirationTime).toBeNull();
    expect(normalized?.keys).toEqual({
      auth: "auth-token",
      p256dh: "p256dh-token",
    });
    expect(typeof normalized?.createdAt).toBe("string");
    expect(typeof normalized?.updatedAt).toBe("string");
    expect(normalized?.userAgent).toBeNull();
    expect(normalized?.deviceId).toBeNull();
    expect(normalized?.ownerUserId).toBeNull();
    expect(normalized?.loginSessionId).toBeNull();

    expect(normalizeStoredWebPushSubscription({ endpoint: "", keys: {} })).toBeNull();
    expect(normalizeStoredWebPushSubscription(null)).toBeNull();
  });

  test("upserts and removes stored subscriptions by endpoint", () => {
    const baseDir = createTempPushDir();

    const created = upsertStoredWebPushSubscription(createSubscription(), {
      baseDir,
      userAgent: "PiClaw Test",
      now: "2026-04-14T18:50:00.000Z",
    });
    const updated = upsertStoredWebPushSubscription(createSubscription(), {
      baseDir,
      userAgent: "PiClaw Test 2",
      now: "2026-04-14T18:55:00.000Z",
    });

    expect(created.createdAt).toBe("2026-04-14T18:50:00.000Z");
    expect(updated.createdAt).toBe("2026-04-14T18:50:00.000Z");
    expect(updated.updatedAt).toBe("2026-04-14T18:55:00.000Z");
    expect(updated.userAgent).toBe("PiClaw Test 2");
    expect(listStoredWebPushSubscriptions(baseDir)).toHaveLength(1);

    expect(removeStoredWebPushSubscription(created.endpoint, baseDir)).toBe(true);
    expect(removeStoredWebPushSubscription(created.endpoint, baseDir)).toBe(false);
    expect(listStoredWebPushSubscriptions(baseDir)).toHaveLength(0);
  });

  test("replaces an existing subscription when the same device gets a new endpoint", () => {
    const baseDir = createTempPushDir();

    upsertStoredWebPushSubscription(createSubscription("https://push.example.test/device/old", "device-1"), {
      baseDir,
      userAgent: "PiClaw Test",
      now: "2026-04-14T19:00:00.000Z",
    });
    const updated = upsertStoredWebPushSubscription(createSubscription("https://push.example.test/device/new", "device-1"), {
      baseDir,
      userAgent: "PiClaw Test",
      now: "2026-04-14T19:05:00.000Z",
      deviceId: "device-1",
    });

    expect(updated.endpoint).toBe("https://push.example.test/device/new");
    expect(updated.deviceId).toBe("device-1");
    expect(listStoredWebPushSubscriptions(baseDir).map((entry) => entry.endpoint)).toEqual([
      "https://push.example.test/device/new",
    ]);
  });

  test("caps the stored subscription list to the newest entries", () => {
    const baseDir = createTempPushDir();
    const previousCap = WEB_RUNTIME_CONFIG.pushSubscriptionCap;
    WEB_RUNTIME_CONFIG.pushSubscriptionCap = 2;

    try {
      upsertStoredWebPushSubscription(createSubscription("https://push.example.test/device/1", "device-1"), {
        baseDir,
        now: "2026-04-14T19:00:00.000Z",
      });
      upsertStoredWebPushSubscription(createSubscription("https://push.example.test/device/2", "device-2"), {
        baseDir,
        now: "2026-04-14T19:01:00.000Z",
      });
      upsertStoredWebPushSubscription(createSubscription("https://push.example.test/device/3", "device-3"), {
        baseDir,
        now: "2026-04-14T19:02:00.000Z",
      });

      expect(listStoredWebPushSubscriptions(baseDir).map((entry) => entry.endpoint)).toEqual([
        "https://push.example.test/device/3",
        "https://push.example.test/device/2",
      ]);
    } finally {
      WEB_RUNTIME_CONFIG.pushSubscriptionCap = previousCap;
    }
  });

  test("binds family subscriptions to an owner and login without cross-owner device replacement", () => {
    const baseDir = createTempPushDir();
    upsertStoredWebPushSubscription(createSubscription("https://push.example.test/alice", "shared-device"), {
      baseDir, ownerUserId: "alice", loginSessionId: "login-alice",
    });
    upsertStoredWebPushSubscription(createSubscription("https://push.example.test/bob", "shared-device"), {
      baseDir, ownerUserId: "bob", loginSessionId: "login-bob",
    });
    expect(listStoredWebPushSubscriptions(baseDir, { ownerUserId: "alice" }).map(entry => entry.endpoint)).toEqual(["https://push.example.test/alice"]);
    expect(listStoredWebPushSubscriptions(baseDir, { ownerUserId: "bob" }).map(entry => entry.endpoint)).toEqual(["https://push.example.test/bob"]);
    expect(removeStoredWebPushSubscription("https://push.example.test/bob", baseDir, { ownerUserId: "alice", loginSessionId: "login-alice" })).toBe(false);
    expect(removeStoredWebPushSubscription("https://push.example.test/alice", baseDir, { ownerUserId: "alice", loginSessionId: "login-alice", deviceId: "wrong" })).toBe(false);
    expect(removeStoredWebPushSubscription("https://push.example.test/alice", baseDir, { ownerUserId: "alice", loginSessionId: "login-alice", deviceId: "shared-device" })).toBe(true);
  });

  test("same owner endpoint refresh preserves the server-selected device identity", () => {
    const baseDir = createTempPushDir(), endpoint = "https://push.example.test/stable";
    upsertStoredWebPushSubscription(createSubscription(endpoint, "first-device"), { baseDir, ownerUserId: "alice", loginSessionId: "login-a" });
    const refreshed = upsertStoredWebPushSubscription(createSubscription(endpoint, "new-page-device"), { baseDir, ownerUserId: "alice", loginSessionId: "login-b" });
    expect(refreshed.deviceId).toBe("first-device"); expect(refreshed.loginSessionId).toBe("login-b");
  });

  test("a browser can rebind an exact subscription but changed keys cannot claim it", () => {
    const baseDir = createTempPushDir(), subscription = createSubscription("https://push.example.test/rebind", "old-device");
    upsertStoredWebPushSubscription(subscription, { baseDir, ownerUserId: "alice", loginSessionId: "login-a" });
    const rebound = upsertStoredWebPushSubscription(subscription, { baseDir, ownerUserId: "bob", loginSessionId: "login-b", allowOwnerRebind: true });
    expect(rebound).toMatchObject({ ownerUserId: "bob", loginSessionId: "login-b", deviceId: "old-device" });
    expect(listStoredWebPushSubscriptions(baseDir, { ownerUserId: "alice" })).toEqual([]);
    expect(() => upsertStoredWebPushSubscription({ ...subscription, keys: { ...subscription.keys, auth: "wrong" } },
      { baseDir, ownerUserId: "alice", loginSessionId: "login-c", allowOwnerRebind: true })).toThrow("Invalid push subscription.");
  });

  test("does not trust owner fields supplied inside a browser subscription body", () => {
    const normalized = normalizeStoredWebPushSubscription({ ...createSubscription(), ownerUserId: "alice", loginSessionId: "login" });
    expect(normalized?.ownerUserId).toBeNull(); expect(normalized?.loginSessionId).toBeNull();
  });

  test("serializes family subscription updates without losing another owner", async () => {
    const baseDir = createTempPushDir();
    await Promise.all(Array.from({ length: 8 }, (_, index) => upsertStoredWebPushSubscriptionAtomic(
      createSubscription(`https://push.example.test/alice/${index}`, `alice-${index}`),
      { baseDir, ownerUserId: "alice", loginSessionId: "login-a", now: new Date(1780000000000 + index).toISOString() },
    )).concat([upsertStoredWebPushSubscriptionAtomic(createSubscription("https://push.example.test/bob/1", "bob-1"),
      { baseDir, ownerUserId: "bob", loginSessionId: "login-b" })]));
    expect(listStoredWebPushSubscriptions(baseDir, { ownerUserId: "alice" })).toHaveLength(8);
    expect(listStoredWebPushSubscriptions(baseDir, { ownerUserId: "bob" })).toHaveLength(1);
  });

  test("caps family subscriptions per owner before applying the instance-wide cap", async () => {
    const baseDir = createTempPushDir(), previousCap = WEB_RUNTIME_CONFIG.pushSubscriptionCap;
    WEB_RUNTIME_CONFIG.pushSubscriptionCap = 32;
    try {
      for (let index = 0; index < 10; index += 1) await upsertStoredWebPushSubscriptionAtomic(
        createSubscription(`https://push.example.test/alice/cap/${index}`, `alice-cap-${index}`),
        { baseDir, ownerUserId: "alice", loginSessionId: "login-a", now: new Date(1780000000000 + index).toISOString() },
      );
      await upsertStoredWebPushSubscriptionAtomic(createSubscription("https://push.example.test/bob/cap", "bob-cap"), { baseDir, ownerUserId: "bob", loginSessionId: "login-b" });
      expect(listStoredWebPushSubscriptions(baseDir, { ownerUserId: "alice" })).toHaveLength(8);
      expect(listStoredWebPushSubscriptions(baseDir, { ownerUserId: "bob" })).toHaveLength(1);
    } finally { WEB_RUNTIME_CONFIG.pushSubscriptionCap = previousCap; }
  });

  test("prunes a recipient snapshot in one serialized write without deleting another owner", async () => {
    const baseDir = createTempPushDir();
    await upsertStoredWebPushSubscriptionAtomic(createSubscription("https://push.example.test/alice/old", "alice-old"), { baseDir, ownerUserId: "alice", loginSessionId: "old" });
    await upsertStoredWebPushSubscriptionAtomic(createSubscription("https://push.example.test/alice/live", "alice-live"), { baseDir, ownerUserId: "alice", loginSessionId: "live" });
    await upsertStoredWebPushSubscriptionAtomic(createSubscription("https://push.example.test/bob/live", "bob-live"), { baseDir, ownerUserId: "bob", loginSessionId: "bob" });
    expect(await pruneStoredWebPushSubscriptions(entry => entry.ownerUserId === "alice" && entry.loginSessionId === "old", baseDir)).toBe(1);
    expect(listStoredWebPushSubscriptions(baseDir).map(entry => entry.endpoint).sort()).toEqual(["https://push.example.test/alice/live", "https://push.example.test/bob/live"]);
  });
});
