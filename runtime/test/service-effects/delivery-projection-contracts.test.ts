import "../helpers.js";

import { describe, expect, test } from "bun:test";

import type { DeliveryBoundary, DeliveryBoundarySuccess, DeliveryDriverError, DeliveryKind } from "../../src/service-effects/contracts/delivery-driver.js";
import { CurrentPiclawDeliveryDriver } from "../../src/service-effects/current-piclaw/delivery-driver.js";
import { defineDeliveryDriverContract, type DeliveryDriverContractSubject } from "../../src/service-effects/testing/contract-suites/delivery-driver-contract.js";
import type { ContractSubjectFactory, ContractTestContext } from "../../src/service-effects/testing/contract-suite.js";
import { TestingCurrentPiclawAdapterRuntime } from "../../src/service-effects/testing/current-piclaw-adapter-runtime.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { FakeDeliveryDriver, type ScriptedDeliveryStep } from "../../src/service-effects/testing/fakes/fake-delivery-driver.js";
import { InMemoryEffectPayloadResolver } from "../../src/service-effects/testing/in-memory-payload-resolver.js";

function createContext(): ContractTestContext {
  return { clock: new ManualEffectClock("2026-08-12T00:00:00.000Z"), ids: new SequenceEffectIdSource("contract"), faults: new DeterministicFaultPlan() };
}

for (const kind of ["timeline_broadcast", "channel_delivery", "web_push", "pushover", "wake_chat"] as const) {
  describe(`EF-S06 DeliveryDriver shared contract: ${kind}`, () => {
    test("current-Piclaw adapter", async () => {
      expect(await defineDeliveryDriverContract(currentDeliveryFactory(kind), createContext)).toHaveLength(18);
    });
    test("independent scripted fake", async () => {
      expect(await defineDeliveryDriverContract(fakeDeliveryFactory(kind), createContext)).toHaveLength(18);
    });
  });
}

function currentDeliveryFactory(kind: DeliveryKind): ContractSubjectFactory<DeliveryDriverContractSubject> {
  const external = { attempts: 0 };
  return {
    name: `current-piclaw-delivery-${kind}`,
    create(context) { external.attempts = 0; return currentDeliverySubject(kind, context, external); },
    crashAndRestore(subject, context) { const current = subject as CurrentDeliverySubject; return { subject: currentDeliverySubject(kind, context, external, current.runtime.restore()), context }; },
    inspectTrace(subject) { return (subject as CurrentDeliverySubject).runtime.snapshot(); },
  };
}

function fakeDeliveryFactory(kind: DeliveryKind): ContractSubjectFactory<DeliveryDriverContractSubject> {
  const external = { attempts: 0 };
  return {
    name: `fake-delivery-${kind}`,
    create() { external.attempts = 0; return fakeDeliverySubject(kind, external); },
    crashAndRestore(subject, context) { const trace = (subject.driver as FakeDeliveryDriver).trace.snapshot(); return { subject: fakeDeliverySubject(kind, external, trace), context }; },
    inspectTrace(subject) { return (subject.driver as FakeDeliveryDriver).trace.snapshot(); },
  };
}

interface CurrentDeliverySubject extends DeliveryDriverContractSubject { readonly runtime: TestingCurrentPiclawAdapterRuntime; }
function currentDeliverySubject(kind: DeliveryKind, context: ContractTestContext, external: { attempts: number }, runtime = new TestingCurrentPiclawAdapterRuntime(context)): CurrentDeliverySubject {
  const payloads = new InMemoryEffectPayloadResolver(); payloads.putText("payload:delivery", "safe payload");
  let resolverOverride: (() => ReturnType<InMemoryEffectPayloadResolver["peek"]> | Promise<ReturnType<InMemoryEffectPayloadResolver["peek"]>>) | null = null;
  let semanticValid: unknown = true; let validatorThrows = false; let classifierThrows = false; let observedPayload: Uint8Array | null = null;
  const queue: Array<DeliveryBoundarySuccess | DeliveryDriverError | DelayedBoundary> = [];
  let attempts = 0;
  const boundary: DeliveryBoundary = {
    async attempt(input) {
      observedPayload = new Uint8Array(input.payload.bytes); attempts += 1; external.attempts += 1;
      const next = queue.shift();
      if (!next) throw new Error("unscripted");
      if ("gate" in next) { next.startedResolve(); await next.gate; return next.success; }
      if ("certainty" in next) throw next;
      return next;
    },
    classifyError(value) { if (classifierThrows) { classifierThrows = false; throw new Error("classifier fault"); } return isDeliveryError(value) ? value : null; },
  };
  const resolver = { resolve(ref: string) { return resolverOverride ? resolverOverride() : payloads.resolve(ref); } };
  const driver = new CurrentPiclawDeliveryDriver(kind, resolver, (expected, request, payload) => {
    if (validatorThrows) { validatorThrows = false; throw new Error("validator fault"); }
    const result = semanticValid; semanticValid = true; return result !== true ? result as boolean : expected === kind && request.destinationRef !== null && payload.mediaType === "text/plain";
  }, boundary, runtime);
  return {
    runtime, driver,
    scriptOutcome(value) { queue.push({ acceptedAt: value.acceptedAt, receiptRef: value.receiptRef, detail: value.detail }); },
    scriptError(value) { queue.push(value); },
    scriptDelayed(value) {
      let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
      let startedResolve!: () => void; const startedPromise = new Promise<void>((resolve) => { startedResolve = resolve; });
      queue.push({ gate, startedResolve, success: { acceptedAt: value.acceptedAt, receiptRef: value.receiptRef, detail: value.detail } });
      return { release, started: () => startedPromise };
    },
    countAttempts() { return attempts; }, countExternalAttempts() { return external.attempts; },
    corruptPayload(corruption) {
      const payload = payloads.peek("payload:delivery")!;
      if (corruption === "semantic") { semanticValid = false; return; }
      if (corruption === "mutable") { resolverOverride = () => ({ ...payload, bytes: new Uint8Array(payload.bytes) }); return; }
      resolverOverride = () => ({ ...payload, ref: corruption === "ref" ? "payload:other" : payload.ref, byteLength: corruption === "length" ? payload.byteLength + 1 : payload.byteLength, sha256: corruption === "digest" ? "0".repeat(64) : payload.sha256 });
    },
    holdPayload() {
      let release!: () => void; let startedResolve!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { startedResolve = resolve; });
      resolverOverride = async () => { startedResolve(); await gate; return payloads.peek("payload:delivery"); };
      return { release, started: () => started };
    },
    throwValidatorOnce() { validatorThrows = true; }, returnValidatorOnce(value) { semanticValid = value; }, throwClassifierOnce() { classifierThrows = true; },
    mutateResolverBytesAfterReturn() {
      const payload = payloads.peek("payload:delivery")!; const bytes = new Uint8Array(payload.bytes);
      return new Promise<void>((resolve) => {
        resolverOverride = () => { setTimeout(() => { bytes.fill(0); resolve(); }, 0); return { ...payload, bytes }; };
      });
    },
    observedPayloadBytes() { return observedPayload ? new Uint8Array(observedPayload) : null; },
  };
}
interface DelayedBoundary { gate: Promise<void>; startedResolve(): void; success: DeliveryBoundarySuccess; }
function isDeliveryError(value: unknown): value is DeliveryDriverError { return Boolean(value && typeof value === "object" && "certainty" in value && "_tag" in value); }

function fakeDeliverySubject(kind: DeliveryKind, external: { attempts: number }, traceSnapshot: ReturnType<FakeDeliveryDriver["trace"]["snapshot"]> = []): DeliveryDriverContractSubject {
  const payloads = new InMemoryEffectPayloadResolver(); payloads.putText("payload:delivery", "safe payload");
  let resolverOverride: (() => ReturnType<InMemoryEffectPayloadResolver["peek"]> | Promise<ReturnType<InMemoryEffectPayloadResolver["peek"]>>) | null = null;
  let semanticValid: unknown = true; let validatorThrows = false;
  const driver = new FakeDeliveryDriver(kind, { resolve(ref) { return resolverOverride ? resolverOverride() : payloads.resolve(ref); } }, (expected, request, payload) => {
    if (validatorThrows) { validatorThrows = false; throw new Error("validator fault"); }
    const result = semanticValid; semanticValid = true; return result !== true ? result as boolean : expected === kind && request.destinationRef !== null && payload.mediaType === "text/plain";
  }, traceSnapshot, () => { external.attempts += 1; });
  const push = (step: ScriptedDeliveryStep) => { driver.script(step); };
  return {
    driver,
    scriptOutcome(value) { push({ _tag: "outcome", outcome: value }); },
    scriptError(value) { push({ _tag: "error", error: value }); },
    scriptDelayed(value) {
      let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
      let startedResolve!: () => void; const startedPromise = new Promise<void>((resolve) => { startedResolve = resolve; });
      push({ _tag: "delay", gate: (async () => { startedResolve(); await gate; })(), next: { _tag: "outcome", outcome: value } });
      return { release, started: () => startedPromise };
    },
    countAttempts() { return driver.countAttempts(); }, countExternalAttempts() { return external.attempts; },
    corruptPayload(corruption) {
      const payload = payloads.peek("payload:delivery")!;
      if (corruption === "semantic") { semanticValid = false; return; }
      if (corruption === "mutable") { resolverOverride = () => ({ ...payload, bytes: new Uint8Array(payload.bytes) }); return; }
      resolverOverride = () => ({ ...payload, ref: corruption === "ref" ? "payload:other" : payload.ref, byteLength: corruption === "length" ? payload.byteLength + 1 : payload.byteLength, sha256: corruption === "digest" ? "0".repeat(64) : payload.sha256 });
    },
    holdPayload() {
      let release!: () => void; let startedResolve!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { startedResolve = resolve; });
      resolverOverride = async () => { startedResolve(); await gate; return payloads.peek("payload:delivery"); };
      return { release, started: () => started };
    },
    throwValidatorOnce() { validatorThrows = true; }, returnValidatorOnce(value) { semanticValid = value; }, throwClassifierOnce() { driver.throwClassifierOnce(); },
    mutateResolverBytesAfterReturn() {
      const payload = payloads.peek("payload:delivery")!; const bytes = new Uint8Array(payload.bytes);
      return new Promise<void>((resolve) => {
        resolverOverride = () => { setTimeout(() => { bytes.fill(0); resolve(); }, 0); return { ...payload, bytes }; };
      });
    },
    observedPayloadBytes() { return driver.observedPayloadBytes(); },
  };
}
