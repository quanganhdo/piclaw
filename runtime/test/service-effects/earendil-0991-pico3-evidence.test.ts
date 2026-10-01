import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import * as pico from "@earendil-works/pi-agent-core/experimental/pico3";
import { EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST as historical } from "../../src/service-effects/earendil-harness-v3-compatibility/manifest.js";
import { boundedPicoWait, controlledPicoModels, openPicoFixture, picoContext as context } from "./fixtures/earendil-0991-pico3-fixture.js";

const packageRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-agent-core/package.json")));
const repositoryRoot = resolve(import.meta.dir, "../../..");
const assessment = JSON.parse(readFileSync(resolve(repositoryRoot, "runtime/test/fixtures/earendil-pico3-0991-assessment.json"), "utf8"));

test("exact0.99.1 Pico3 public barrel preserves historical shape without adopting SQLite or drive", () => {
  expect(JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")).version).toBe("0.99.1");
  expect(Object.keys(pico)).toHaveLength(30);
  for (const [path, sha256] of [
    ["index.js", "ce575fbbbd66e9bcb67ff0b6be483c5baefd1750cb10adaa1d73aedb9d66eafe"],
    ["index.d.ts", "1ef74b8615a31ec9eed49cfd9fa657b68958af82f1b6c480dfb40d65703a6d72"],
    ["session.js", "263ffac4b262b13b569c93520d859b8ca1eb1e5cbad32d14f18a5fa1dee4c1ae"],
    ["view.js", "0e0aadac888bf85858313112d990c09033fbaa963d56186400c6771b20d36856"],
    ["legacy-tracker.js", "1514c18e2887402add4cfd897c01862076ac750d9cacf9c48926fdc77f5899ea"],
  ]) expect(createHash("sha256").update(readFileSync(resolve(packageRoot, "dist/harness/pico3", path))).digest("hex"), path).toBe(sha256);
  expect("SqliteStorage" in pico).toBe(false);
  expect("drive" in pico.Harness.prototype).toBe(false);
  expect("permit" in pico.Harness.prototype).toBe(false);
});

test("versioned assessment preserves historical outcomes and every Piclaw service authority", () => {
  expect(assessment).toMatchObject({ version: "0.99.1", commit: "d86654abb8862e201933517d6f1fce9f88dd117f", productionImport: false, productionActivation: false });
  expect(createHash("sha256").update(JSON.stringify(historical.experimentalPico3)).digest("hex")).toBe("1ede405a32b24ae4ed6631dc922fd528420515951ab7b500493d91b610ef3c88");
  expect(assessment.unsupportedHarnessCases).toEqual(historical.experimentalPico3.harnessCases.filter(row => row.status === "unsupported").map(row => row.id));
  expect(assessment.authorities).toEqual([
    ["EF-S01", "ServiceWorkStore", "retained_piclaw"], ["EF-S02", "TerminalSettlementStore", "retained_piclaw"],
    ["EF-S05", "ServiceOutboxStore", "retained_piclaw"], ["EF-S07", "ScheduledRunStore", "retained_piclaw"],
    ["EF-S08", "AgentProjectionSink", "retained_piclaw"],
  ]);
  expect(assessment.piclawServiceCases).toBe("PC-001_through_PC-020_unverified");
  expect(assessment.processHost).toBe("unverified_not_exercised");
  expect(assessment.recommendation.productionAdoption).toBe("no_go");
  const patch = gunzipSync(readFileSync(resolve(repositoryRoot, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0870-to-0991-pico3.patch.gz")));
  expect(createHash("sha256").update(patch).digest("hex")).toBe(assessment.sourceDelta.patchSha256);
  for (const [path, sha256] of Object.entries(assessment.fingerprints)) {
    expect(createHash("sha256").update(readFileSync(resolve(packageRoot, "dist/harness/pico3", path))).digest("hex")).toBe(sha256);
  }
});

test("archived plain Node and Bun public imports match exact exports and memory roundtrip", () => {
  for (const runtime of ["node", "bun"]) {
    const receipt = JSON.parse(readFileSync(resolve(repositoryRoot, `docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-pico3-${runtime}.json`), "utf8"));
    expect(receipt).toMatchObject({ version: assessment.version, memoryRoundtrip: "pass", providerExecution: "no_provider_constructed_by_probe", sqliteExport: false, productionActivation: false });
    expect(receipt.exports).toEqual(Object.keys(pico).sort());
    expect(receipt.executionModel).toEqual({ resume: true, drive: false, permit: false });
    expect(receipt.runtime).toMatch(runtime === "node" ? /^Node / : /^Bun /);
  }
});

for (const backend of ["Memory", "JSONL"] as const) describe(`public0.99.1 Pico3 ${backend}`, () => {
  test("send admits input without provider work until resume and deduplicates requestId", async () => {
    const fixture = await openPicoFixture(backend);
    try {
      const input = await fixture.conversation.send({ content: "hello", requestId: "one" }, context);
      const duplicate = await fixture.conversation.send({ content: "duplicate", requestId: "one" }, context);
      expect(duplicate.id).toBe(input.id);
      expect(fixture.provider.calls()).toBe(0);
      fixture.harness.resume();
      expect((await boundedPicoWait(input.wait(context))).status).toBe("done");
      await boundedPicoWait(fixture.conversation.waitForIdle(context));
      expect(fixture.provider.calls()).toBe(1);
      expect((await fixture.harness.entries({ conversationId: fixture.conversation.id, limit: 100 }, context)).filter(entry => entry.kind === "pi.user")).toHaveLength(1);
      expect(fixture.reports).toEqual([]);
    } finally { await fixture.cleanup(); }
  });

  test("Chord config reads see same-transaction updates and rollback leaves published state intact", async () => {
    const fixture = await openPicoFixture(backend);
    try {
      await fixture.conversation.commit(tx => {
        tx.config(fixture.conversation.id).set("profile", "changed");
        expect(tx.config(fixture.conversation.id).get("profile")).toBe("changed");
        expect(tx.snapshot({ doc: "rewindable", conversationId: fixture.conversation.id }).profile).toBe("changed");
      }, context);
      await expect(fixture.conversation.commit(tx => {
        tx.config(fixture.conversation.id).set("profile", "rolled-back");
        throw new Error("controlled rollback");
      }, context)).rejects.toThrow("controlled rollback");
      expect((await fixture.conversation.config.get(context)).profile).toBe("changed");
      expect(fixture.provider.calls()).toBe(0);
    } finally { await fixture.cleanup(); }
  });

  test("public watch envelopes fold to the fresh snapshot across Chord tracker writes", async () => {
    const fixture = await openPicoFixture(backend);
    let watch: Awaited<ReturnType<typeof fixture.conversation.watch>> | undefined;
    try {
      watch = await fixture.conversation.watch(context);
      let projected = structuredClone(watch.view);
      const revisions: number[] = [];
      watch.start(envelope => { projected = pico.applyEnvelope(projected, envelope); revisions.push(envelope.revision); });
      await fixture.conversation.config.set({ profile: "watched" }, context);
      await fixture.conversation.write({ kind: "fixture.note" }, context);
      const fresh = await fixture.conversation.watch(context);
      try { expect(projected).toEqual(fresh.view); }
      finally { fresh.stop(); }
      expect(revisions.length).toBeGreaterThan(0);
      expect(new Set(revisions).size).toBe(revisions.length);
      expect(fixture.provider.calls()).toBe(0);
    } finally { watch?.stop(); await fixture.cleanup(); }
  });

  test("queued cancellation removes only its selected input while the active turn completes", async () => {
    const provider = controlledPicoModels(true), fixture = await openPicoFixture(backend, provider);
    try {
      fixture.harness.resume();
      const first = await fixture.conversation.send({ content: "blocked" }, context);
      await boundedPicoWait(provider.arrival);
      const queued = await fixture.conversation.send({ content: "cancel only this", whenBusy: "followUp" }, context);
      expect(await boundedPicoWait(queued.abort(context))).toBe("aborted");
      expect(await boundedPicoWait(queued.result(context))).toMatchObject({ status: "unanswered", reason: "aborted" });
      provider.release();
      expect((await boundedPicoWait(first.wait(context))).status).toBe("done");
      await boundedPicoWait(fixture.conversation.waitForIdle(context));
      expect(provider.calls()).toBe(1);
      expect(fixture.reports).toEqual([]);
    } finally { await fixture.cleanup(); }
  });

  test("active abort cancels the controlled provider and drains without a successor call", async () => {
    const provider = controlledPicoModels(true), fixture = await openPicoFixture(backend, provider);
    try {
      fixture.harness.resume();
      const input = await fixture.conversation.send({ content: "abort active" }, context);
      await boundedPicoWait(provider.arrival);
      await boundedPicoWait(fixture.conversation.abort(context));
      await boundedPicoWait(fixture.conversation.waitForIdle(context));
      expect(await boundedPicoWait(input.result(context))).toMatchObject({ status: "unanswered", reason: "aborted" });
      expect(provider.calls()).toBe(1);
      expect(provider.aborts()).toBe(1);
      expect(provider.settled()).toBe(1);
      expect(fixture.harness.quiescent()).toBe(true);
      expect(fixture.reports).toEqual([]);
    } finally { await fixture.cleanup(); }
  });
});

test("JSONL close/reopen preserves undriven input identity and executes once after resume", async () => {
  const fixture = await openPicoFixture("JSONL");
  try {
    const first = await fixture.conversation.send({ content: "persist", requestId: "reopen-one" }, context);
    const reopened = await fixture.reopen();
    const retry = await reopened.conversation.send({ content: "do not duplicate", requestId: "reopen-one" }, context);
    expect(retry.id).toBe(first.id);
    expect(fixture.provider.calls()).toBe(0);
    reopened.harness.resume();
    expect((await boundedPicoWait(retry.wait(context))).status).toBe("done");
    await boundedPicoWait(reopened.conversation.waitForIdle(context));
    expect(fixture.provider.calls()).toBe(1);
    expect(fixture.reports).toEqual([]);
  } finally { await fixture.cleanup(); }
});
