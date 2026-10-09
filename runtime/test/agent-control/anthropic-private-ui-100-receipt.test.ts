import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(import.meta.dir, "../../..");
test("1.0.0 Anthropic private UI receipt covers both engines without broadening acceptance", () => {
  const receipt = JSON.parse(readFileSync(resolve(repo, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-100-anthropic-private-ui.json"), "utf8"));
  expect(receipt.version).toBe("1.0.0"); expect(receipt.runtime).toBe("Bun 1.4.2");
  expect(receipt.scope).toBe("builtin_anthropic_copy_code_private_card_and_recording_fixture");
  expect(receipt.familyGateway).toBe("not_exercised"); expect(receipt.liveAccounts).toBe(false);
  // Preserve this exact 1.0.0 receipt; current SDK qualification is separate.
  expect(receipt.anthropicSha256).toBe("80fc4412ce09d42d678f5094932f3e58eecec53df40c4530fc4f55651a57d0a4");
  expect(receipt.results.map((row: { browser: string; scenario: string }) => [row.browser, row.scenario])).toEqual(
    ["chromium", "webkit"].flatMap(browser => ["success", "denial-retry", "bad-state", "cancel-prompt", "cancel-exchange"].map(scenario => [browser, scenario])));
  for (const row of receipt.results) {
    expect(row.version).toBe("1.0.0"); expect(row.unexpectedNetwork).toBe(0);
    expect(row.tokenRequests).toBe(row.scenario === "denial-retry" ? 2 : ["success", "cancel-exchange"].includes(row.scenario) ? 1 : 0);
    expect(row.transportAborted).toBe(row.scenario === "cancel-exchange");
    expect(row.modelActivated).toBe(["success", "denial-retry"].includes(row.scenario));
    expect(row.privateHeadersChecked).toBe(true); expect(row.allChatRowsChecked).toBe(true); expect(row.fullRecordingAndExportsChecked).toBe(true);
    expect(row.redactionFallback).toBe(false); expect(row.callbackListenerObserved).toBe(false); expect(row.inference).toBe("not_invoked");
  }
});

test("private UI preload rejects an ordinary namespace before runtime imports", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", resolve(repo, "runtime/test/web/fixtures/anthropic-private-ui-100-preload.ts"), "-e", 'console.log("MUST_NOT_EXECUTE")'], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", SYNTHETIC_PARENT_NETNS: readlinkSync("/proc/self/ns/net"), SYNTHETIC_EXPECT_UID: String(process.getuid?.()) }, stdout: "pipe", stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(out).toBe(""); expect(err).toContain("A distinct network namespace is required.");
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
});
