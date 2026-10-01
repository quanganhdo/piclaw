import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fingerprints: Record<string, string> = {
  "anthropic.js": "a3583c93176f5a7f250d8f1c384351de9b6fadcc4ddddc7c87b89288d1031f2a",
  "openrouter.js": "b69e807ed855095aa17b2c0d1a15f350c77e3a49f2a66853f227916daacb4703",
  "callback-server.js": "2dda468f4937edcf7bb5e8528de4bf7753efbe5b48610a3f9ea47ff2c4908ede",
  "pkce.js": "d54668654e89d6fe6994a09a7f9399e732a411fcb31c99eb8b5e60349763708c",
};
const modes = ["manual-success", "callback-success", "callback-invalid-first", "callback-denied", "token-denied", "malformed-json", "cancel-prompt", "cancel-exchange", "pre-abort"];
test("browser-method receipts pin exact public SDK files and twenty separate-runtime outcomes", () => {
  const receipts = ["bun", "node"].map(runtime => JSON.parse(readFileSync(resolve(import.meta.dir, `../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-provider-browser-${runtime}.json`), "utf8")));
  expect(receipts[0].results).toEqual(receipts[1].results);
  for (const [index, receipt] of receipts.entries()) {
    expect(receipt.version).toBe("0.99.1"); expect(receipt.runtime).toMatch(index === 0 ? /^Bun 1\.4\.2$/ : /^Node 26\.7\.0$/);
    expect(receipt.scope).toBe("public_anthropic_openrouter_browser_manual_methods_only");
    expect(receipt.bootstrapRequests).toBe(0); expect(receipt.credentialPersistence).toBe("none"); expect(receipt.inference).toBe("not_invoked");
    expect(receipt.networkGuard).toBe("distinct_loopback_only_os_namespace_guarded_fetch_and_owned_ipv4_callbacks");
    expect(receipt.results.map((row: { provider: string; mode: string }) => [row.provider, row.mode])).toEqual(
      ["anthropic", "openrouter"].flatMap(provider => [...modes, provider === "anthropic" ? "manual-bad-state" : "missing-key"].map(mode => [provider, mode])));
    for (const row of receipt.results) {
      expect(row.status).toBe("pass"); expect(row.requests.unexpected).toBe(0);
      expect(row.requests.exchange).toBe(["cancel-prompt", "callback-denied", "manual-bad-state", "pre-abort"].includes(row.mode) ? 0 : 1);
      expect(row.callbackServerReleased).toBe(row.mode !== "pre-abort" || row.provider === "anthropic");
      if (row.mode === "cancel-exchange") expect(row.transportCancellationObserved).toBe(true);
    }
    const root = import.meta.resolve("@earendil-works/pi-ai");
    expect(receipt.sdkFileSha256).toEqual(fingerprints);
    for (const [file, expected] of Object.entries(fingerprints)) {
      expect(createHash("sha256").update(readFileSync(fileURLToPath(new URL(`auth/oauth/${file}`, root)))).digest("hex")).toBe(expected);
    }
  }
});

test("browser-method fixture refuses an ordinary network namespace before provider imports", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/provider-browser-matrix-0991.mjs")], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", SYNTHETIC_PARENT_NETNS: readlinkSync("/proc/self/ns/net"), SYNTHETIC_EXPECT_UID: String(process.getuid?.()) }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(out).toBe(""); expect(err).toContain("A distinct network namespace is required.");
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
});
