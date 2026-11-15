import { expect, spyOn, test } from "bun:test";
import { AgentQueue } from "../../src/queue.js";

import { importFresh, withTempWorkspaceEnv } from "../helpers.js";

const legacyPollingPool = { isDurableRuntime: () => false };

function pollingState(chatJids: string[]) {
  return {
    chatJids: new Set(chatJids),
    lastTimestamp: "",
    saveTimestamps: () => {},
  } as unknown as import("../../src/runtime/state.js").RuntimeState;
}

function makeMessage(chatJid: string, content: string, timestamp: string) {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chat_jid: chatJid,
    sender: "user",
    sender_name: "User",
    content,
    timestamp,
    is_from_me: false,
    is_bot_message: false,
  };
}

test('polling exposes no direct message processor or executable dependency',async()=>{
  const loop=await import('../../src/runtime/message-loop.js');
  expect(loop).not.toHaveProperty('processMessages');
});
for(const native of [true,false])test('pending non-web input remains replayable without queue/cursor/command effects, native='+native,async()=>{
  await withTempWorkspaceEnv('piclaw-unadmitted-poll-',{},async()=>{
    const db=await importFresh<typeof import('../../src/db.js')>('../src/db.js');db.initDatabase();
    const loop=await importFresh<typeof import('../../src/runtime/message-loop.js')>('../src/runtime/message-loop.js');
    const chat='custom:unadmitted';
    for(const text of ['@Pi ordinary','@Pi /model test/model','@Pi /help'])db.storeMessage(makeMessage(chat,text,'2026-04-17T02:00:00.000Z'));
    const state=pollingState([chat]);let effects=0;
    state.saveTimestamps=()=>{effects++;};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),0);
    const before=db.getDb().serialize();
    try{await loop.runMessageLoop({state,assistantName:'Pi',pollIntervalMs:60000,
      agentPool:{isDurableRuntime:()=>native,runAgent:()=>{effects++;},applyControlCommand:()=>{effects++;}},
      queue:{enqueue:()=>{effects++;}},processMessages:()=>{effects++;},
    } as any,controller.signal);}finally{clearTimeout(timer);controller.abort();}
    expect(effects).toBe(0);expect(state.lastTimestamp).toBe('');expect(db.getDb().serialize()).toEqual(before);
    expect(db.getNewMessages([chat],'','Pi').messages).toHaveLength(3);
  });
});

test("abort during poll sleep clears timer and listener without another poll", async () => {
  await withTempWorkspaceEnv("piclaw-poller-stop-", {}, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    db.initDatabase();
    const controller = new AbortController();
    const queue = new AgentQueue();
    const state = pollingState([]);
    let polls = 0;
    Object.defineProperty(state, "lastTimestamp", { get: () => { polls++; return ""; } });
    const timers = spyOn(globalThis, "setTimeout");
    const clear = spyOn(globalThis, "clearTimeout");
    const remove = spyOn(controller.signal, "removeEventListener");
    try {
      const running = loop.runMessageLoop({ agentPool: legacyPollingPool, queue, state, assistantName: "Pi", pollIntervalMs: 60_000, processMessages: async () => true }, controller.signal);
      expect(polls).toBe(1);
      const timer = timers.mock.results.at(-1)!.value;
      controller.abort();
      await running;
      expect(clear).toHaveBeenCalledWith(timer);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(polls).toBe(1);
      expect(queue.getMetrics().enqueued).toBe(0);
    } finally { timers.mockRestore(); clear.mockRestore(); remove.mockRestore(); await queue.shutdown(); }
  });
});

test("stop after readonly fetch admits nothing and leaves cursor replayable", async () => {
  await withTempWorkspaceEnv("piclaw-poller-stop-", {}, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    db.initDatabase();
    const chat = "wa:stop-before-admission";
    db.storeMessage(makeMessage(chat, "@Pi hello", "2026-04-17T02:00:00.000Z"));
    const controller = new AbortController();
    const queue = new AgentQueue();
    const state = pollingState([chat]);
    let saves = 0;
    state.saveTimestamps = () => { saves++; };
    Object.defineProperty(state, "lastTimestamp", { get: () => { controller.abort(); return ""; } });
    await loop.runMessageLoop({ agentPool: legacyPollingPool, queue, state, assistantName: "Pi", pollIntervalMs: 60_000, processMessages: async () => true }, controller.signal);
    expect(queue.getMetrics().enqueued).toBe(0);
    expect(saves).toBe(0);
    expect(db.getNewMessages([chat], "", "Pi").messages).toHaveLength(1);
    await queue.shutdown();
  });
});

test("shutdown joins poll then waits for accepted asynchronous queue processing before pool disposal", async () => {
  await withTempWorkspaceEnv("piclaw-poller-stop-", {}, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    const { createShutdownHandler } = await import("../../src/runtime/shutdown.js");
    db.initDatabase();
    const chat = "wa:held-notification";
    db.storeMessage(makeMessage(chat, "@Pi hello", "2026-04-17T02:00:00.000Z"));
    const queue = new AgentQueue();
    const controller = new AbortController();
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const queueStopping = Promise.withResolvers<void>();
    const calls: string[] = [];
    // Accepted work comes from its own admitted source, never this readonly poller.
    queue.enqueue(async()=>{entered.resolve();await release.promise;calls.push('notification-complete');},'accepted-native-fixture');
    const running=loop.runMessageLoop({state:pollingState([chat]),assistantName:'Pi',pollIntervalMs:60000},controller.signal);
    const exit = spyOn(process, "exit").mockImplementation((() => {}) as any);
    let stopping: Promise<void> | undefined;
    try {
      await entered.promise;
      const shutdown = createShutdownHandler({
        stopMessageLoop: () => { controller.abort(); return running.then(() => { calls.push("poll-joined"); }); },
        stopIpcWatcher: async () => {}, stopSchedulerLoop: () => {}, stopOptionalProviders: () => {},
        queue: { shutdown: async () => { calls.push("queue-stop"); queueStopping.resolve(); await queue.shutdown(); } },
        agentPool: { shutdown: async () => { calls.push("pool-stop"); } },
        web: { stop: async () => {} },
      });
      stopping = shutdown("test");
      await queueStopping.promise;
      expect(calls).toEqual(["poll-joined", "queue-stop"]);
      release.resolve();
      await stopping;
      expect(calls).toEqual(["poll-joined", "queue-stop", "notification-complete", "pool-stop"]);
      expect(queue.getMetrics().enqueued).toBe(1);
      expect(queue.getMetrics().succeeded).toBe(1);
    } finally { release.resolve(); controller.abort(); await running; await stopping; await queue.shutdown(); exit.mockRestore(); }
  });
});

test("already stopped loop never polls", async () => {
  await withTempWorkspaceEnv("piclaw-poller-stop-", {}, async () => {
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    const controller = new AbortController(); controller.abort();
    const state = pollingState([]);
    Object.defineProperty(state, "chatJids", { get: () => { throw new Error("must not poll"); } });
    const queue = new AgentQueue();
    await loop.runMessageLoop({ agentPool: legacyPollingPool, queue, state, assistantName: "Pi", pollIntervalMs: 60_000, processMessages: async () => true }, controller.signal);
    expect(queue.getMetrics().enqueued).toBe(0);
    await queue.shutdown();
  });
});
