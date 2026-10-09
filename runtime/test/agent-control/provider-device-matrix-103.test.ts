import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const historicalTest = JSON.parse(readFileSync(new URL("../../../node_modules/@earendil-works/pi-ai/package.json", import.meta.url), "utf8")).version === "1.0.3" ? test : test.skip;
const modes = ["pending-success", "denied", "malformed-device", "malformed-token", "blocked-cancel", "expiry", "slow-down", "unsafe-device-uri", "initial-wait-cancel", "pending-wait-cancel", "slow-wait-cancel"];
historicalTest("public Copilot and Kimi device methods execute synthetic polling, failure and cancellation matrix", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/provider-device-matrix-103.mjs")], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err).toBe(0); expect(err).toBe("");
    const executed = JSON.parse(out);
    expect(executed.results.map((row: any) => [row.provider, row.mode])).toEqual(["github-copilot", "kimi-coding"].flatMap(provider => modes.map(mode => [provider, mode])));
    expect(executed.results.every((row: any) => row.status === "pass" && row.requests.unexpected === 0)).toBe(true);
    expect(executed.modelPolicyWrites).toBe("none");
    expect(executed.credentialPersistence).toBe("none");
    for (const runtime of ["bun"]) {
      const archived = JSON.parse(readFileSync(resolve(import.meta.dir, `../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-103-provider-devices-${runtime}.json`), "utf8"));
      expect(archived.results).toEqual(executed.results);
      expect(archived.sdkFileSha256).toEqual(executed.sdkFileSha256);
      expect(archived.runtime).toMatch(runtime === "node" ? /^Node / : /^Bun /);
    }
    expect(out).not.toContain("SYNTHETIC-CODE");
    expect(out).not.toContain("synthetic-kimi-access");
    expect(out).not.toContain("synthetic-github-refresh");
  } finally {
    clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited;
  }
}, 35_000);
