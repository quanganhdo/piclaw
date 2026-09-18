import { describe, expect, test } from "bun:test";

import "../helpers.js";

import { createAttemptToolBudgetController } from "../../src/agent-pool/run-agent-attempt-budget.js";

describe("prompt attempt tool budget", () => {
  test("blocks newly emitted tool calls during the recovery finalization reserve", async () => {
    let activeTools = ["read", "bash"];
    const session = {
      agent: {},
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names: string[]) => { activeTools = [...names]; },
    } as any;
    const controller = createAttemptToolBudgetController({
      session,
      chatJid: "web:test-finalization-reserve",
      initialToolExecutionCount: 0,
      toolUseMessageBudget: 64,
      toolUseWarningThreshold: 48,
      runOptions: {},
      getRunObservabilityDetails: () => ({}),
    });

    expect(controller.applyFinalizationReserve()).toBe(true);
    expect(activeTools).toEqual([]);
    const blocked = await session.agent.beforeToolCall({
      toolCall: { id: "call-after-reserve", name: "bash" },
      args: { command: "echo late" },
    });
    expect(blocked).toEqual({
      block: true,
      reason: "Automatic recovery is in its finalization window. Return a terminal assistant reply without calling more tools.",
    });
    // Earendil 0.84.2 lets blocked pre-tool hooks terminate a batch. Budget
    // blocks must omit that hint so the model still produces a terminal reply.
    expect(blocked.terminate).toBeUndefined();
    expect(controller.applyFinalizationReserve()).toBe(false);

    controller.restoreToolBudgetGuard();
    controller.restoreToolBudgetSoftStop();
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("locks the tool surface immediately after the completed execution budget is reached", async () => {
    let activeTools = ["read", "bash"];
    const session = {
      agent: {},
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names: string[]) => { activeTools = [...names]; },
    } as any;
    const controller = createAttemptToolBudgetController({
      session,
      chatJid: "web:test-completed-budget",
      initialToolExecutionCount: 0,
      toolUseMessageBudget: 2,
      toolUseWarningThreshold: 1,
      runOptions: {},
      getRunObservabilityDetails: () => ({}),
    });

    expect(await session.agent.beforeToolCall({ toolCall: { id: "call-a", name: "read" }, args: {} })).toBeUndefined();
    expect(await session.agent.beforeToolCall({ toolCall: { id: "call-b", name: "read" }, args: {} })).toBeUndefined();
    controller.consumeToolExecutionEnd("call-a", false);
    controller.consumeToolExecutionEnd("call-b", false);
    controller.enforceCompletedExecutionBudget();

    expect(controller.state.toolUseBudgetExceeded).toBe(true);
    expect(activeTools).toEqual([]);
    const blocked = await session.agent.beforeToolCall({ toolCall: { id: "call-c", name: "bash" }, args: {} });
    expect(blocked).toEqual({
      block: true,
      reason: "Per-turn tool execution budget exhausted (2/2). Ask the user to continue before calling more tools.",
    });
    expect(blocked.terminate).toBeUndefined();

    controller.restoreToolBudgetGuard();
    controller.restoreToolBudgetSoftStop();
    expect(activeTools).toEqual(["read", "bash"]);
  });

  test("applies a deferred soft stop after every threshold-crossing tool call finishes", () => {
    let activeTools = ["read", "bash"];
    const session = {
      agent: {},
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names: string[]) => { activeTools = [...names]; },
    } as any;
    const controller = createAttemptToolBudgetController({
      session,
      chatJid: "web:test-attempt-budget",
      initialToolExecutionCount: 0,
      toolUseMessageBudget: 2,
      toolUseWarningThreshold: 1,
      runOptions: {},
      getRunObservabilityDetails: () => ({}),
    });

    controller.requestToolBudgetSoftStop([{ id: "call-a" }, { id: "call-b" }], 2);
    expect(controller.state.toolUseSoftStopApplied).toBe(false);
    expect(activeTools).toEqual(["read", "bash"]);

    controller.consumeToolExecutionEnd("call-a", false);
    expect(controller.state.toolUseSoftStopApplied).toBe(false);
    expect(activeTools).toEqual(["read", "bash"]);

    controller.consumeToolExecutionEnd("call-b", false);
    expect(controller.state.toolUseSoftStopApplied).toBe(true);
    expect(activeTools).toEqual([]);

    controller.restoreToolBudgetSoftStop();
    expect(activeTools).toEqual(["read", "bash"]);
  });
});

test("restricted operation rechecks policy and tool name at actual execution and reserves a hard cap", async () => {
  let allowed = true;
  let priorCalls = 0;
  const original = async () => { priorCalls++; return undefined; };
  const session = { agent: { beforeToolCall: original }, getActiveToolNames: () => ['read','bash'], setActiveToolsByName: () => {} } as any;
  const controller = createAttemptToolBudgetController({session,chatJid:'operation:test',initialToolExecutionCount:0,toolUseMessageBudget:20,toolUseWarningThreshold:18,
    runOptions:{requireToolCeiling:true,toolCeilingFilter:name=>name==='read',executionAdmissionCheck:()=>allowed,maxToolCalls:1},getRunObservabilityDetails:()=>({})});
  const signal = new AbortController().signal;
  const invoke = (name:string,id:string) => session.agent.beforeToolCall({toolCall:{id,name,arguments:{}}},signal);
  expect((await invoke('bash','no')).block).toBe(true);expect(priorCalls).toBe(0);
  allowed=false;expect((await invoke('read','revoked')).block).toBe(true);expect(priorCalls).toBe(0);
  allowed=true;expect(await invoke('read','one')).toBeUndefined();expect(priorCalls).toBe(1);
  expect((await invoke('read','two')).block).toBe(true);expect(priorCalls).toBe(1);
  controller.restoreToolBudgetGuard();expect(session.agent.beforeToolCall).toBe(original);
});

test("restricted hard cap survives concurrent asynchronous pre-tool hooks", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const session={agent:{beforeToolCall:async()=>{await gate;return undefined;}},getActiveToolNames:()=>['read'],setActiveToolsByName:()=>{}} as any;
  const controller=createAttemptToolBudgetController({session,chatJid:'operation:parallel',initialToolExecutionCount:0,toolUseMessageBudget:20,toolUseWarningThreshold:18,runOptions:{requireToolCeiling:true,toolCeilingFilter:()=>true,maxToolCalls:1},getRunObservabilityDetails:()=>({})});
  const signal=new AbortController().signal;
  const pending=[1,2,3].map(id=>session.agent.beforeToolCall({toolCall:{id:String(id),name:'read'}},signal));
  release();const results=await Promise.all(pending);
  expect(results.filter(r=>r?.block)).toHaveLength(2);expect(controller.state.reservedToolExecutionCount).toBe(1);controller.restoreToolBudgetGuard();
});
