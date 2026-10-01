import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modes = ["success", "denied", "malformed_device", "malformed_token", "cancel", "slow_down"];
test("public Codex device flow preserves endpoint, failure, cancellation and real slow-down behavior", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/codex-device-flow-0991.mjs"), ...modes], {
    env: { PATH: "/usr/local/lib/bun/bin:/usr/bin:/bin", HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" },
    stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(err).toBe("");
    expect(exit).toBe(0);
    const result = JSON.parse(out);
    expect(result.results.map((row: any) => row.mode)).toEqual(modes);
    expect(result.results.every((row: any) => row.status === "pass" && row.requests.unknown === 0)).toBe(true);
    expect(result.results.find((row: any) => row.mode === "cancel").cancellationObserved).toBe(true);
    expect(result.results.find((row: any) => row.mode === "slow_down").slowDownDelayVerified).toBe(true);
    for (const runtime of ["bun", "node"]) {
      const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, `../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-codex-device-${runtime}.json`), "utf8"));
      expect(receipt.results).toEqual(result.results);
      expect(receipt.sdkFileSha256).toEqual(result.sdkFileSha256);
      expect(receipt.runtime).toMatch(runtime === "node" ? /^Node / : /^Bun /);
      expect(receipt.credentialPersistence).toBe("none");
    }
    expect(out).not.toContain("synthetic-refresh");
    expect(out).not.toContain("synthetic-authorization-code");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
}, 25_000);
