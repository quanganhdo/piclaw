import { expect, test } from "bun:test";
import { load } from "js-yaml";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkPublishSmokeGate } from "../../../scripts/check-publish-smoke-gate";

const root = resolve(import.meta.dir, "../../..");
const workflow = load(readFileSync(join(root, ".github/workflows/publish.yml"), "utf8")) as Record<string, any>;

test("both digest-bound image smoke checks gate manifest and complete-release publication", () => {
  expect(() => checkPublishSmokeGate(workflow)).not.toThrow();
});

for (const arch of ["amd64", "arm64"]) {
  for (const change of ["step-advisory", "job-advisory", "skip", "mutable-image", "timeout"]) {
    test(`${arch} contract rejects ${change}`, () => {
      const candidate = structuredClone(workflow);
      const job = candidate.jobs[`build-${arch}`];
      const step = job.steps.find((s: Record<string, any>) => s.name === `Smoke test ${arch.toUpperCase()} image`);
      if (change === "step-advisory") step["continue-on-error"] = true;
      if (change === "job-advisory") job["continue-on-error"] = true;
      if (change === "skip") step.if = "false";
      if (change === "mutable-image") step.run = step.run.replace("@${{ steps.build.outputs.digest }}", ":latest");
      if (change === "timeout") step["timeout-minutes"] = 10;
      expect(() => checkPublishSmokeGate(candidate)).toThrow();
    });
  }
}

test("a partial image or portable failure cannot be bypassed downstream", () => {
  for (const mutate of [
    (w: Record<string, any>) => { w.jobs.merge.needs = ["build-amd64"]; },
    (w: Record<string, any>) => { w.jobs.merge.if = "always()"; },
    (w: Record<string, any>) => { w.jobs["publish-portable-assets"].if = "always()"; },
    (w: Record<string, any>) => { w.jobs["publish-portable-assets"].needs = ["merge"]; },
  ]) {
    const candidate = structuredClone(workflow);
    mutate(candidate);
    expect(() => checkPublishSmokeGate(candidate)).toThrow();
  }
});

// Exercise the real shell entrypoint without creating containers or contacting Docker.
for (const scenario of ["pass", "binary", "http", "supervisor"]) {
  test(`smoke entrypoint ${scenario}: propagates status and cleans resources`, () => {
    const dir = mkdtempSync(join(tmpdir(), "publish-smoke-test-"));
    const log = join(dir, "calls");
    writeFileSync(join(dir, "docker"), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1" in
  run)
    if [ "$2" = --rm ]; then
      if [ "$SCENARIO" = binary ]; then exit 23; fi
      printf '1.4.2\\nrestic 0.18.1\\n=== Pi CLI ===\\n=== Piclaw CLI ===\\n'
    else echo container-id; fi ;;
  volume) if [ "$2" = create ]; then echo test-volume; fi ;;
  port) echo 127.0.0.1:12345 ;;
  inspect) if [ "$2" = -f ]; then echo false; fi ;;
  exec) if [ "$SCENARIO" = supervisor ]; then exit 1; fi ;;
esac
`);
    writeFileSync(join(dir, "curl"), '#!/usr/bin/env bash\n[ "$SCENARIO" != http ]\n');
    for (const file of ["docker", "curl"]) chmodSync(join(dir, file), 0o755);
    try {
      const result = Bun.spawnSync(["bash", join(root, "scripts/docker/publish-smoke-test.sh"),
        "example/image@sha256:test", "linux/amd64", "1.4.2", "0.18.1"], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TMPDIR: dir, CALL_LOG: log, SCENARIO: scenario },
        stdout: "pipe", stderr: "pipe", timeout: 40000,
      });
      expect(result.exitCode).toBe(scenario === "pass" ? 0 : scenario === "binary" ? 23 : 1);
      const calls = readFileSync(log, "utf8");
      expect(calls).toContain("example/image@sha256:test");
      if (scenario !== "binary") expect(calls).toContain("rm -f container-id");
      if (scenario === "pass") {
        expect(calls).toContain("volume rm -f test-volume");
        expect(calls.match(/run -d/g)).toHaveLength(2);
      }
      if (scenario === "http") expect(result.stderr.toString()).toContain("container exited before serving");
      if (scenario === "supervisor") expect(result.stderr.toString()).toContain("supervisor status check failed");
      expect(readdirSync(dir).filter((name) => name.startsWith("tmp."))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);
}
