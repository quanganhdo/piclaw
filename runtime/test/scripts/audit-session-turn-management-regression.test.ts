import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT_PATH = resolve(import.meta.dir, "../../..", "scripts", "audit-session-turn-management-regression.sh");

test("audit session-turn-management regression runner dispatches categories without eval", () => {
  const root = mkdtempSync(join(tmpdir(), "piclaw-audit-runner-"));
  const fakeBin = join(root, "bin");
  const argsFile = join(root, "bun-args.txt");
  const markerFile = join(root, "injected");

  try {
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      join(fakeBin, "bun"),
      `#!/usr/bin/env bash
printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}
exit 0
`,
      { mode: 0o755 },
    );

    const safeRun = Bun.spawnSync([
      "bash",
      "-lc",
      `
        set -euo pipefail
        export PATH=${JSON.stringify(`${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`)}
        source ${JSON.stringify(SCRIPT_PATH)}
        cd "$PROJECT_DIR"
        run_category_check queue_and_threading
      `,
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(safeRun.exitCode).toBe(0);
    expect(readFileSync(argsFile, "utf8").trim().split("\n")).toEqual([
      "run",
      "../runtime/scripts/local-test-priority.ts",
      "--",
      "bun",
      "test",
      "test/channels/web/web-channel.test.ts",
    ]);

    const injectedRun = Bun.spawnSync([
      "bash",
      "-lc",
      `
        set -euo pipefail
        source ${JSON.stringify(SCRIPT_PATH)}
        run_category_check ${JSON.stringify(`queue_and_threading; touch ${markerFile}`)}
      `,
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(injectedRun.exitCode).toBe(64);
    expect(injectedRun.stderr.toString()).toContain("Unknown audit category");
    expect(existsSync(markerFile)).toBe(false);
    expect(readFileSync(SCRIPT_PATH, "utf8")).not.toContain('eval "$cmd"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
