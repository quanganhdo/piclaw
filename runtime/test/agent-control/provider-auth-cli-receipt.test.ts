import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(import.meta.dir, "../../..");
const receipt = JSON.parse(readFileSync(resolve(repo, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-packaged-cli-auth-bun.json"), "utf8"));
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
test("packaged CLI receipt pins the admitted archive, bundle and eight synthetic terminal outcomes", () => {
  const registry = JSON.parse(readFileSync(resolve(repo, "runtime/test/fixtures/earendil-package-admission/registry-0.99.1.json"), "utf8"));
  expect(receipt.packageIntegrity).toBe(registry.find((pkg: { name: string }) => pkg.name === "@earendil-works/pi-coding-agent").dist.integrity);
  expect(receipt.version).toBe("0.99.1"); expect(receipt.runtime).toMatch(/^Bun /);
  expect(receipt.scope).toBe("official_earendil_packaged_interactive_cli_synthetic_auth_only");
  expect(receipt.officialArchiveComparison).toBe("all_bundled_js_bytes_equal");
  expect(receipt.lockSha256).toBe(digest(resolve(repo, "bun.lock")));
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  const bundle = resolve(packageRoot, "dist/bundle");
  const files = [...new Bun.Glob("**/*.js").scanSync(bundle)].sort();
  expect(files.length).toBe(receipt.bundleFileCount);
  expect(createHash("sha256").update(files.map(file => `${file}\0${digest(resolve(bundle, file))}\n`).join("")).digest("hex")).toBe(receipt.bundleSha256);
  const aiRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"))));
  for (const file of ["openai-chatgpt.js", "openai-codex.js"]) expect(receipt.sdkFileSha256[file]).toBe(digest(resolve(aiRoot, "dist/auth/oauth", file)));
  expect(receipt.results.map((row: { provider: string; mode: string }) => [row.provider, row.mode])).toEqual(
    ["openai", "openai-codex"].flatMap(provider => ["success", "denied", "bad-state", "cancel"].map(mode => [provider, mode])));
  for (const row of receipt.results) {
    expect(row).toMatchObject({ status: "pass", browserLauncher: "test_owned_noop", externalEgress: "os_namespace_denied", unexpectedFetchRequests: 0,
      networkGuard: "distinct_loopback_only_os_namespace_and_stable_preload", cliExit: "restored_editor_quit_0", inference: "not_invoked" });
    expect(row.tokenRequests).toBe(["success", "denied"].includes(row.mode) ? 1 : 0);
    expect(row.credentialPersistence).toBe(row.mode === "success" ? "disposable_profile" : "none");
  }
});

test("CLI fixture refuses ordinary network namespace execution before profile creation", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "cli-refusal-"));
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/packaged-cli-auth-0991.ts"), "openai", "success", root, readlinkSync("/proc/self/ns/net")], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", SYNTHETIC_EXPECT_UID: String(process.getuid?.()) }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(out).toBe("");
    expect(err).toContain("A distinct network namespace is required.");
    expect(existsSync(resolve(root, "agent"))).toBe(false);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; rmSync(root, { recursive: true, force: true }); }
});
