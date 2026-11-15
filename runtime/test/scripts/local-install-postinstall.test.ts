import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../..");

async function installFixture(failPostinstall: boolean) {
  const root = await mkdtemp(join(tmpdir(), "local-postinstall-"));
  const bunRoot = join(root, "bun");
  const stage = join(root, "scratch");
  const pack = join(root, "pack");
  const commands = join(root, "commands");
  const pkg = join(root, "source/package");
  try {
    for (const directory of [join(bunRoot, "bin"), pack, commands, join(pkg, "scripts"), join(pkg, "runtime/src")]) {
      await mkdir(directory, { recursive: true });
    }
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "piclaw", version: "3.3.4" }));
    await writeFile(join(pkg, "runtime/src/index.ts"), "// fixture CLI\n");
    await writeFile(join(pkg, "scripts/postinstall.ts"), `import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
writeFileSync(resolve(import.meta.dir, "../postinstall-ran"), "ran");
if (process.env.PICLAW_TEST_POSTINSTALL_FAIL === "1") throw new Error("fixture postinstall failure");
`);
    const sudo = join(commands, "sudo");
    await writeFile(sudo, "#!/bin/sh\nexec env \"$@\"\n");
    await chmod(sudo, 0o755);
    const bun = join(bunRoot, "bin/bun");
    // Model a successful global install whose dependency lifecycle was blocked.
    // Every other invocation uses the real Bun, including the packaged hook.
    await writeFile(bun, `#!/bin/sh
set -eu
if [ "$1" = install ]; then
  mkdir -p "$BUN_INSTALL/install/global/node_modules"
  tar -xzf "$3" -C "$BUN_INSTALL/install/global/node_modules"
  mv "$BUN_INSTALL/install/global/node_modules/package" "$BUN_INSTALL/install/global/node_modules/piclaw"
  ln -s "$BUN_INSTALL/install/global/node_modules/piclaw/runtime/src/index.ts" "$BUN_INSTALL/bin/piclaw"
  echo 'Blocked 1 postinstall' >&2
else
  exec ${JSON.stringify(process.execPath)} "$@"
fi
`);
    await chmod(bun, 0o755);
    const tar = Bun.spawn(["tar", "-czf", join(pack, "piclaw-3.3.4.tgz"), "-C", join(root, "source"), "package"], {
      stdout: "pipe", stderr: "pipe",
    });
    expect(await tar.exited).toBe(0);
    const child = Bun.spawn(["make", "-o", "pack", "local-install", `BUN_ROOT=${bunRoot}`, `PICLAW_TMPDIR=${stage}`,
      `PACK_DIR=${pack}`, `BUN_CACHE_DIR=${join(root, "cache")}`, `CACHE_TMP_BASE=${root}`], {
      cwd: repo,
      env: { ...process.env, PATH: `${commands}:${process.env.PATH}`, PICLAW_TEST_POSTINSTALL_FAIL: failPostinstall ? "1" : "0" },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    const marker = await readFile(join(bunRoot, "install/global/node_modules/piclaw/postinstall-ran"), "utf8").catch(() => null);
    return { exitCode, output: stdout + stderr, marker };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("canonical local install runs the packaged postinstall even when Bun blocks lifecycle scripts", async () => {
  const result = await installFixture(false);
  expect(result.output).toContain("Blocked 1 postinstall");
  expect(result.marker).toBe("ran");
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("[local-install] Install complete (no restart)");
});

test("canonical local install stops before success when the packaged postinstall fails", async () => {
  const result = await installFixture(true);
  expect(result.marker).toBe("ran");
  expect(result.output).toContain("fixture postinstall failure");
  expect(result.exitCode).not.toBe(0);
  expect(result.output).not.toContain("[local-install] Install complete");
});
