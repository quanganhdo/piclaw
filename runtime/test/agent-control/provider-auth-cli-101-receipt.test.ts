import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "../../..");
const artifactPath = resolve(root, "runtime/test/fixtures/earendil-package-admission/cli-artifact-1.0.1.json");
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

test("1.0.1 CLI artifact and measured outcomes remain separate from historical receipts", () => {
  expect(digest(artifactPath)).toBe("5c57536ef7a2ec2580fb4e581c38f709dd9d70a90e052df523e3f8c552cf6ea3");
  expect(artifact.version).toBe("1.0.1"); expect(artifact.gitHead).toBe("a7229ddc21810d6245105978033b7df645ecc2f7");
  const registry = JSON.parse(readFileSync(resolve(root, "runtime/test/fixtures/earendil-package-admission/registry-1.0.1.json"), "utf8"));
  for (const pkg of artifact.packages) {
    const published = registry.find((entry: { name: string }) => entry.name === pkg.name);
    expect(pkg.version).toBe(published.version); expect(pkg.gitHead).toBe(published.gitHead);
    expect(pkg.shasum).toBe(published.dist.shasum); expect(pkg.integrity).toBe(published.dist.integrity);
    expect(pkg.treeSha256).toMatch(/^[a-f0-9]{64}$/); expect(pkg.files).toBeGreaterThan(800);
  }
  // Historical bundle/OAuth fingerprints are recorded evidence, not current SDK assertions.
  expect(artifact.bundleFileCount).toBe(74); expect(artifact.bundleSha256).toMatch(/^[a-f0-9]{64}$/);
  const receipt = JSON.parse(readFileSync(resolve(root, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-packaged-cli-auth-bun.json"), "utf8"));
  expect(receipt.version).toBe("1.0.1"); expect(receipt.runtime).toBe("Bun 1.4.2"); expect(receipt.artifact).toEqual(artifact);
  expect(receipt.results.map((row: { provider: string; mode: string }) => [row.provider, row.mode])).toEqual(
    ["openai", "openai-codex"].flatMap(provider => ["success", "denied", "bad-state", "cancel", "provider-only"].map(mode => [provider, mode])));
  for (const row of receipt.results) {
    expect(row.status).toBe("pass"); expect(row.version).toBe("1.0.1"); expect(row.runtime).toBe("Bun 1.4.2");
    expect(row.unexpectedFetchRequests).toBe(0); expect(row.inference).toBe("not_invoked"); expect(row.bundleSha256).toBe(artifact.bundleSha256);
    expect(row.credentialPersistence).toBe(row.mode === "success" ? "disposable_profile" : "none");
    expect(row.tokenRequests).toBe(["success", "denied"].includes(row.mode) ? 1 : 0);
    if (row.mode === "provider-only") {
      expect(row.exitCode).toBe(1); expect(row.diagnostic).toBe("provider_requires_model"); expect(row.browserLauncher).toBe("not_invoked");
    } else {
      expect(row.browserLauncher).toBe("test_owned_noop"); expect(row.cliExit).toBe("restored_editor_quit_0"); expect(row.externalEgress).toBe("os_namespace_denied");
      expect(row.networkGuard).toBe("distinct_loopback_only_os_namespace_and_stable_preload");
      expect(row.bundleFileCount).toBe(74); expect(row.sdkFileSha256).toEqual(artifact.sdkFileSha256);
      expect(row.codexBrowserChoiceVerified).toBe(row.provider === "openai-codex"); expect(row.hostIdVerified).toBe(row.provider === "openai");
    }
  }
});

test("1.0.1 CLI fixture rejects ordinary-namespace execution before creating a profile", async () => {
  const scratch = mkdtempSync(resolve(tmpdir(), "cli100-refusal-"));
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/packaged-cli-auth-101.ts"), "openai", "success", scratch, readlinkSync("/proc/self/ns/net")], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", SYNTHETIC_EXPECT_UID: String(process.getuid?.()) }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(out).toBe(""); expect(err).toContain("A distinct network namespace is required."); expect(existsSync(resolve(scratch, "agent"))).toBe(false);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; rmSync(scratch, { recursive: true, force: true }); }
});
