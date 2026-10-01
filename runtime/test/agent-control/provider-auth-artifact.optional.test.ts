import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createTempWorkspace } from "../helpers.js";

const enabled = process.env.PICLAW_RUN_AUTH_ARTIFACT_TESTS === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
const artifactTest = enabled ? test : test.skip;

artifactTest("packed Piclaw model services execute public OpenAI and Codex auth in an isolated install", async () => {
  const root = resolve(import.meta.dir, "../../..");
  const workspace = createTempWorkspace("packed-auth-");
  const prefix = join(workspace.base, "prefix"), profile = join(workspace.base, "agent");
  const artifacts = join(workspace.base, "artifacts"), home = join(workspace.base, "home"), scratch = join(workspace.base, "tmp");
  for (const dir of [prefix, artifacts, home, scratch]) mkdirSync(dir, { recursive: true });
  const cache = process.env.BUN_INSTALL_CACHE_DIR ?? join(workspace.base, "cache");
  mkdirSync(cache, { recursive: true });
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
    BUN_INSTALL_CACHE_DIR: cache, PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true",
    PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data,
    PICLAW_PI_AGENT_DIR: profile, PI_CODING_AGENT_DIR: profile,
  };
  async function run(command: string[], cwd: string) {
    const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    try {
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (code !== 0) throw new Error(`Artifact stage failed: ${command[1]}\n${err.slice(-4000)}`);
      return { out, err };
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }
  }
  try {
    const sourceCommit = (await run(["git", "rev-parse", "HEAD"], root)).out.trim();
    await run([process.execPath, "pm", "pack", "--destination", artifacts], root);
    const archives = readdirSync(artifacts).filter(name => name.endsWith(".tgz"));
    expect(archives).toHaveLength(1);
    const archive = join(artifacts, archives[0]);
    const tarballSha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(join(prefix, "package.json"), JSON.stringify({ name: "disposable-auth-consumer", private: true, type: "module" }));
    // This stage may fetch package dependencies. Auth execution below has its
    // own exact-endpoint mock and inherits no account credentials.
    await run([process.execPath, "add", "--cwd", prefix, archive], prefix);
    const packedModuleSha256: Record<string, string> = {};
    for (const path of ["runtime/src/agent-pool/model-services.ts", "runtime/src/agent-pool/credential-store.ts"]) {
      // Hash archive bytes, not a checkout or installed-module substitution.
      const bytes = (await run(["tar", "-xOf", archive, `package/${path}`], prefix)).out;
      packedModuleSha256[path] = createHash("sha256").update(bytes).digest("hex");
    }
    writeFileSync(join(prefix, "artifact-provenance.json"), JSON.stringify({
      kind: "bun_pm_pack_staged_install", tarballSha256, sourceCommit, checkoutRoot: root, packedModuleSha256,
    }));
    copyFileSync(join(import.meta.dir, "fixtures/packed-provider-auth-0991.mjs"), join(prefix, "consumer.mjs"));
    const { out, err } = await run([process.execPath, "--no-env-file", join(prefix, "consumer.mjs"), prefix, profile], prefix);
    expect(err).toBe("");
    const receipt = JSON.parse(out);
    expect(receipt.tarballSha256).toBe(tarballSha256);
    expect(receipt.packedModuleSha256).toEqual(packedModuleSha256);
    expect(Object.keys(receipt.sdkFileSha256)).toHaveLength(5);
    expect(receipt.results).toEqual(["openai", "openai-codex"].map(provider => ({ provider, login: "pass", rotation: "pass", reopen: "pass", logout: "pass" })));
    expect(receipt.mockedTokenRequests).toBe(4);
    expect(receipt.unexpectedNetwork).toBe(0);
    expect(receipt.cliLogin).toBe("not_exercised");
    expect(receipt.webUi).toBe("not_exercised");
    expect(receipt.networkGuard).toBe("fetch_and_preconnect_only_no_os_network_sandbox");
    expect(out).not.toContain("synthetic-initial-refresh");
    expect(out).not.toContain("synthetic-rotated-refresh");
    // The supplied output path is caller-owned; omitted in ordinary test runs.
    if (process.env.PICLAW_AUTH_ARTIFACT_RECEIPT) writeFileSync(process.env.PICLAW_AUTH_ARTIFACT_RECEIPT, `${JSON.stringify(receipt)}\n`);
  } finally {
    workspace.cleanup();
  }
}, 540_000);
